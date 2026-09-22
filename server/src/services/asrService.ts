/**
 * 讯飞 ASR 流式听写客户端（T1.4）
 *
 * D11 核实结论（2026-09-22 web 搜索 + 官方文档）：
 *   - 端点：wss://iat-api.xfyun.cn/v2/iat（WebSocket）
 *   - 鉴权：URL 查询参数 host/date/authorization
 *     authorization = base64( api_key="..", algorithm="hmac-sha256",
 *       headers="host date request-line", signature="base64(hmac-sha256(secret, 签名原文))" )
 *     签名原文 = `host: iat-api.xfyun.cn\ndate: {RFC1123}\nGET /v2/iat HTTP/1.1`
 *   - 帧协议（JSON）：
 *     首帧 common{app_id} + business{language/domain/accent/vad_eos/dwa} + data{status:0}
 *     中间帧 data{status:1, audio}
 *     尾帧 data{status:2}（无音频）
 *   - 服务端结果帧：data.result 含 ws 词列表；data.status===2 为最终帧
 *     dwa=wpgs 时 pgs==='rpl'（bg..ed 替换）/ 'apd'（追加），实现动态纠错
 *   - 约束：单次会话音频 ≤60s；帧间隔 40-1000ms（客户端 200ms 分片天然满足）
 *
 * 职责（单一）：把 PCM 流转成文本流（onPartial/onFinal 回调）
 * 不负责：会话绑定（T1.7）、音频转发（handler）
 */
import WebSocket from 'ws';
import { createHmac } from 'node:crypto';
import { config } from '../config.js';
import { logger } from '../utils/logger.js';
import { SAMPLE_RATE } from '../websocket/protocol.js';

/** ASR 业务错误 */
export class AsrError extends Error {
  constructor(message: string, public readonly code: string = 'ASR_FAILED') {
    super(message);
    this.name = 'AsrError';
  }
}

/** ASR 流回调集合 */
export interface AsrCallbacks {
  /** 中间结果（动态修正后的全量中间文本） */
  onPartial?: (text: string) => void;
  /** 最终结果（本轮完整文本，status===2 时触发一次） */
  onFinal?: (text: string) => void;
  /** 错误（连接/协议/服务端 code!=0） */
  onError?: (err: AsrError) => void;
}

/** 一路正在进行的听写会话句柄 */
export interface AsrSession {
  /** 写入一段 PCM 音频（内部自动首帧/中间帧封包） */
  write(chunk: Buffer): void;
  /** 结束本轮听写（发尾帧，等服务端最终结果后关闭） */
  finish(): void;
  /** 立即中止（客户端断开/interrupt 时；不发尾帧直接关连接） */
  abort(): void;
}

/** 讯飞结果帧 data.result 的最小结构（D6：只定义用到的字段） */
interface XfResult {
  sn: number;             // 子句序号（1 开始）
  pgs?: 'rpl' | 'apd';    // wpgs 模式：替换/追加
  bg?: number;            // rpl：被替换起始 sn
  ed?: number;            // rpl：被替换结束 sn
  ws?: Array<{ cw: Array<{ w: string }> }>; // 词列表
}

interface XfFrame {
  code?: number;
  message?: string;
  sid?: string;
  data?: { result?: XfResult; status?: number };
}

/** 构造鉴权 URL（HMAC-SHA256 签名） */
function buildAuthUrl(): string {
  if (!config.xunfeiAsr.appId || !config.xunfeiAsr.apiKey || !config.xunfeiAsr.apiSecret) {
    throw new AsrError('讯飞 ASR 配置缺失（XUNFEI_APP_ID/ASR_API_KEY/ASR_API_SECRET）');
  }
  const host = 'iat-api.xfyun.cn';
  const path = '/v2/iat';
  const date = new Date().toUTCString(); // RFC1123

  const signatureOrigin = `host: ${host}\ndate: ${date}\nGET ${path} HTTP/1.1`;
  const signature = createHmac('sha256', config.xunfeiAsr.apiSecret)
    .update(signatureOrigin)
    .digest('base64');
  const authorizationOrigin =
    `api_key="${config.xunfeiAsr.apiKey}", algorithm="hmac-sha256", ` +
    `headers="host date request-line", signature="${signature}"`;
  const authorization = Buffer.from(authorizationOrigin).toString('base64');

  return `wss://${host}${path}?host=${encodeURIComponent(host)}&date=${encodeURIComponent(date)}&authorization=${encodeURIComponent(authorization)}`;
}

/** 拼接子句词文本 */
function resultTextOf(result: XfResult): string {
  return (result.ws ?? [])
    .map((w) => (w.cw ?? []).map((c) => c.w).join(''))
    .join('');
}

/**
 * 创建一路流式听写会话
 *
 * 生命周期：open → write()* → finish() → onFinal → close
 *           任意阶段出错 → onError → close；abort() 直接 close
 */
export function createAsrSession(callbacks: AsrCallbacks, timeoutMs = 60_000): AsrSession {
  // ---- 状态 ----
  let ws: WebSocket;
  let firstFrameSent = false;
  let finished = false;
  let closed = false;
  /** 按子句 sn 累积的文本片段（wpgs 动态修正） */
  const sentenceMap = new Map<number, string>();
  let finalText = '';
  let timer: NodeJS.Timeout | undefined;

  const fail = (err: AsrError): void => {
    if (closed) return;
    cleanup();
    callbacks.onError?.(err);
    safeClose();
  };

  const safeClose = (): void => {
    if (closed) return;
    closed = true;
    cleanup();
    try {
      if (ws && ws.readyState <= WebSocket.OPEN) ws.close();
    } catch { /* 忽略关闭异常 */ }
  };

  const cleanup = (): void => {
    if (timer) clearTimeout(timer);
  };

  // ---- 连接 ----
  let url: string;
  try {
    url = buildAuthUrl();
  } catch (err) {
    // 同步错误转异步回调（保持错误路径统一）
    queueMicrotask(() => fail(err instanceof AsrError ? err : new AsrError(String(err))));
    return deadSession();
  }

  ws = new WebSocket(url);
  // 超时兜底：60s 内未收到最终帧则判失败（听写单会话上限即 60s）
  timer = setTimeout(() => {
    if (!finished) fail(new AsrError('ASR 会话超时（60s 未收到最终结果）'));
  }, timeoutMs);

  ws.on('open', () => {
    logger.debug('ASR WebSocket 已连接');
  });

  ws.on('message', (raw) => {
    let frame: XfFrame;
    try {
      frame = JSON.parse(String(raw)) as XfFrame;
    } catch {
      fail(new AsrError('ASR 结果帧 JSON 解析失败'));
      return;
    }
    if (frame.code !== 0) {
      fail(new AsrError(`ASR 服务错误 code=${frame.code} ${frame.message ?? ''}`));
      return;
    }
    const result = frame.data?.result;
    if (!result) return;

    // wpgs 动态修正：rpl 删除 bg..ed 的子句再写入当前句
    if (result.pgs === 'rpl' && result.bg !== undefined && result.ed !== undefined) {
      for (let sn = result.bg; sn <= result.ed; sn++) {
        sentenceMap.delete(sn);
      }
    }
    sentenceMap.set(result.sn, resultTextOf(result));

    // 中间结果：按 sn 排序拼接全量文本
    if (frame.data?.status !== 2) {
      const partial = [...sentenceMap.entries()]
        .sort((a, b) => a[0] - b[0])
        .map(([, text]) => text)
        .join('');
      callbacks.onPartial?.(partial);
      return;
    }

    // 最终帧：收尾
    finalText = [...sentenceMap.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([, text]) => text)
      .join('');
    finished = true;
    callbacks.onFinal?.(finalText);
    safeClose();
  });

  ws.on('error', (err) => {
    fail(new AsrError(`ASR 连接错误: ${err.message}`));
  });

  ws.on('close', () => {
    cleanup();
    if (!finished && !closed) {
      // 未收到最终帧就断开（网络/服务端主动断）
      callbacks.onError?.(new AsrError('ASR 连接在最终结果前关闭'));
    }
    closed = true;
  });

  // ---- 封包发送 ----
  const sendJson = (payload: unknown): void => {
    if (ws.readyState !== WebSocket.OPEN) return; // 已断开：静默丢弃（abort 场景）
    ws.send(JSON.stringify(payload));
  };

  return {
    write(chunk: Buffer): void {
      if (closed || finished) return;
      const audio = chunk.toString('base64');
      if (!firstFrameSent) {
        firstFrameSent = true;
        // 首帧：业务参数 + 音频
        sendJson({
          common: { app_id: config.xunfeiAsr.appId },
          business: {
            language: 'zh_cn',
            domain: 'iat',
            accent: 'mandarin',
            vad_eos: config.vad.vadEosMs, // 服务端静音断句（本项目 800ms）
            dwa: 'wpgs',                  // 动态修正（中间结果纠错）
          },
          data: {
            status: 0,
            format: `audio/L16;rate=${SAMPLE_RATE}`,
            encoding: 'raw',
            audio,
          },
        });
      } else {
        sendJson({
          data: { status: 1, format: `audio/L16;rate=${SAMPLE_RATE}`, encoding: 'raw', audio },
        });
      }
    },

    finish(): void {
      if (closed || finished || !firstFrameSent) {
        // 没写过音频的空会话：直接关闭不发尾帧
        safeClose();
        return;
      }
      sendJson({ data: { status: 2 } });
    },

    abort(): void {
      safeClose();
    },
  };
}

/** 配置缺失时返回的哑会话（所有操作静默，错误经 onError 抛出） */
function deadSession(): AsrSession {
  return {
    write: () => undefined,
    finish: () => undefined,
    abort: () => undefined,
  };
}
