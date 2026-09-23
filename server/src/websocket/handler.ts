/**
 * 消息分发处理器（T1.2）
 *
 * 职责：
 *   - 接收原始字符串消息 → JSON 解析 → 结构校验 → 按类型路由
 *   - 非法消息（解析失败/字段缺失/type 不识别）返回 error(INVALID_MESSAGE) 且**服务不崩**（验收标准）
 *   - 心跳 ping → pong
 *   - audio/text/control：本阶段仅记录并回执日志，业务处理等 T1.3-T1.6/T1.7 接入
 *     （D7 不写 mock：不伪造 ASR/LLM/TTS 返回）
 *
 * 阶段一后续接入点（标注 TODO-T1.x）：
 *   - audio → T1.4 讯飞 ASR 流式听写
 *   - text  → T1.7 直接进 LLM 流式管线（调试通道）
 *   - control.interrupt → T1.7 中断当前播报
 */
import type { WebSocket } from 'ws';
import type {
  ClientMessage,
  ServerConversationResetMessage,
  ServerErrorMessage,
  ServerLlmChunkMessage,
  ServerLlmEndMessage,
  ServerLlmRetryMessage,
  ServerPongMessage,
} from './protocol.js';
import type { Session, SessionManager } from './session.js';
import { streamLlmReply } from '../services/llmService.js';
import { config } from '../config.js';
import { logger } from '../utils/logger.js';

/** 构造 error 消息（服务端 → 客户端） */
function buildErrorMessage(code: ServerErrorMessage['code'], message: string, sessionId?: string): ServerErrorMessage {
  return { type: 'error', code, message, sessionId, timestamp: Date.now() };
}

/** 安全发送：连接非 OPEN 状态静默跳过（D8 错误边界） */
function safeSend(ws: WebSocket, msg: unknown): void {
  if (ws.readyState !== ws.OPEN) return;
  try {
    ws.send(JSON.stringify(msg));
  } catch (err) {
    logger.error({ err }, '发送消息失败');
  }
}

/** 校验并窄化客户端消息（D6 禁 any：用类型守卫而非断言） */
function isValidClientMessage(raw: unknown): raw is ClientMessage {
  if (typeof raw !== 'object' || raw === null) return false;
  const obj = raw as Record<string, unknown>;
  if (typeof obj.type !== 'string') return false;
  switch (obj.type) {
    case 'audio':
      return typeof obj.data === 'string' && typeof obj.isLast === 'boolean';
    case 'text':
      return typeof obj.data === 'string';
    case 'control':
      return obj.action === 'recording_start' || obj.action === 'recording_end' || obj.action === 'interrupt'
        || obj.action === 'new_conversation';
    case 'ping':
      return true;
    default:
      return false;
  }
}

/**
 * 处理一条来自客户端的原始消息
 * 入口唯一 wsServer.on('message') 调用；内部全 try-catch，任何异常都转为 error 消息（不崩服务）
 */
export function handleMessage(sessions: SessionManager, ws: WebSocket, raw: string): void {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    // JSON 解析失败：返回 error 且不崩（验收标准）
    safeSend(ws, buildErrorMessage('INVALID_MESSAGE', '消息不是合法 JSON'));
    return;
  }

  // 结构校验
  if (!isValidClientMessage(parsed)) {
    safeSend(ws, buildErrorMessage('INVALID_MESSAGE', '消息格式不合法（type/data/isLast/action 字段缺失或不匹配）'));
    return;
  }

  // 绑定/查找会话：首条消息决定 sessionId
  let session = sessions.getSessionByWs(ws);
  if (!session) {
    const clientSessionId = typeof (parsed as { sessionId?: unknown }).sessionId === 'string'
      ? (parsed as { sessionId: string }).sessionId
      : undefined;
    session = sessions.createSession(ws, clientSessionId);
  }
  sessions.touch(session);

  try {
    dispatch(sessions, session, parsed);
  } catch (err) {
    // 分发过程任何异常：兜底 error，不崩服务（验收标准）
    logger.error({ err, sessionId: session.sessionId }, '消息分发异常');
    safeSend(ws, buildErrorMessage('INTERNAL_ERROR', '服务端内部错误', session.sessionId));
  }
}

/** 按消息类型路由 */
function dispatch(sessions: SessionManager, session: Session, msg: ClientMessage): void {
  switch (msg.type) {
    case 'ping': {
      // 心跳：立即回 pong，刷新心跳时间
      session.lastPingAt = Date.now();
      const pong: ServerPongMessage = {
        type: 'pong',
        sessionId: session.sessionId,
        timestamp: Date.now(),
      };
      safeSend(session.ws, pong);
      break;
    }

    case 'text': {
      // 文本直传（调试通道）→ LLM 流式管线
      // 2026-09-23 提前接入（用户指令）：text 消息直接进 LLM，流式下发 llm_chunk → llm_end
      // TTS 按句合成部分仍留待 T1.5/T1.6 完成后在 T1.7 全量接入
      session.textMessageCount += 1;
      const text = msg.data.trim();
      if (text.length === 0) {
        safeSend(session.ws, buildErrorMessage('INVALID_MESSAGE', '文本消息不能为空', session.sessionId));
        break;
      }
      if (session.llmInFlight) {
        safeSend(session.ws, buildErrorMessage('RATE_LIMIT', '上一条回复仍在生成中，请稍候', session.sessionId));
        break;
      }

      // 对话静默超时：超过 idleResetMs 无用户内容消息，本条视为新对话（对应"每次唤醒新对话"）
      const idleMs = Date.now() - session.lastContentAt;
      session.lastContentAt = Date.now();
      if (session.history.length > 0 && idleMs > config.conversation.idleResetMs) {
        session.history = [];
        logger.info({ sessionId: session.sessionId, idleMs }, '对话静默超时，自动开启新对话');
      }

      session.llmInFlight = true;
      logger.info({ sessionId: session.sessionId, len: text.length }, '收到文本消息，进入 LLM 流式管线');

      // 异步流式调用（dispatch 为同步入口，这里 fire-and-forget，结果通过 WS 下发）
      void streamLlmReply(text, [...session.history], {
        onDelta: (delta) => {
          const chunk: ServerLlmChunkMessage = {
            type: 'llm_chunk',
            sessionId: session.sessionId,
            text: delta,
            isFinal: false,
            timestamp: Date.now(),
          };
          safeSend(session.ws, chunk);
        },
        // 429 限流重试进度：下发 llm_retry，客户端展示"重试中(N/M)"
        onRetry: (retry, maxRetries) => {
          const notice: ServerLlmRetryMessage = {
            type: 'llm_retry',
            sessionId: session.sessionId,
            retry,
            maxRetries,
            timestamp: Date.now(),
          };
          safeSend(session.ws, notice);
        },
      })
        .then((result) => {
          // 写入会话历史（多轮上下文），截断保留最近 N 条
          session.history.push(
            { role: 'user', content: text },
            { role: 'assistant', content: result.fullText },
          );
          if (session.history.length > config.conversation.historyMaxMessages) {
            session.history.splice(0, session.history.length - config.conversation.historyMaxMessages);
          }
          const end: ServerLlmEndMessage = {
            type: 'llm_end',
            sessionId: session.sessionId,
            fullText: result.fullText,
            timestamp: Date.now(),
          };
          safeSend(session.ws, end);
          logger.info(
            { sessionId: session.sessionId, elapsedMs: result.elapsedMs, len: result.fullText.length },
            'LLM 流式回复完成',
          );
        })
        .catch((err: unknown) => {
          const message = err instanceof Error ? err.message : String(err);
          safeSend(session.ws, buildErrorMessage('LLM_FAILED', message, session.sessionId));
        })
        .finally(() => {
          session.llmInFlight = false;
        });
      break;
    }

    case 'audio': {
      // 音频分片 → TODO-T1.4 接入讯飞 ASR 流式听写
      session.audioChunkCount += 1;
      if (session.audioChunkCount % 25 === 0 || msg.isLast) {
        // 每 5 秒（25 个 chunk）或本轮结束时打一条摘要日志，避免刷屏
        logger.info(
          { sessionId: session.sessionId, seq: msg.seq, isLast: msg.isLast, total: session.audioChunkCount },
          '收到音频分片（待 T1.4 接入 ASR）',
        );
      }
      break;
    }

    case 'control': {
      // 控制消息 → recording_start/end 记录状态；interrupt 待 T1.7 支持打断
      logger.info(
        { sessionId: session.sessionId, action: msg.action },
        '收到控制消息',
      );
      if (msg.action === 'new_conversation') {
        // 开启新对话（车机"每次唤醒 = 新对话"语义）：清历史 + 清断线缓存
        session.history = [];
        sessions.clearHistoryCache(session.sessionId);
        const ack: ServerConversationResetMessage = {
          type: 'conversation_reset',
          sessionId: session.sessionId,
          timestamp: Date.now(),
        };
        safeSend(session.ws, ack);
        logger.info({ sessionId: session.sessionId }, '已开启新对话（历史已清除）');
      }
      if (msg.action === 'interrupt') {
        // TODO-T1.7：中断当前 LLM 流 + 停止 TTS 推送
        logger.info({ sessionId: session.sessionId }, 'interrupt 暂未实现（T1.7）');
      }
      break;
    }

    default: {
      // 类型系统上不可达（isValidClientMessage 已过滤），保险兜底
      const exhaustive: never = msg;
      logger.error({ msg: exhaustive }, '未识别的消息类型（不应到达）');
    }
  }
}
