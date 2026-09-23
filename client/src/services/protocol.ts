/**
 * WebSocket 协议 - 客户端侧类型定义（T2.3）
 *
 * 与 server/src/websocket/protocol.ts（T1.1 冻结版）保持一致。
 * 客户端只使用文本通道（调试）+ 心跳；audio/control 待 T2.1/T2.6 接入。
 * 协议变更需同步更新 server 端定义与《项目文档》3.2。
 */

// ==========================================
// 客户端 → 服务端
// ==========================================

/** 文本直传消息（调试通道，绕过 ASR 直接给 LLM） */
export interface ClientTextMessage {
  type: 'text';
  sessionId: string;
  data: string;
  timestamp: number;
}

/** 应用层心跳消息 */
export interface ClientPingMessage {
  type: 'ping';
  sessionId: string;
  timestamp: number;
}

export type ClientMessage = ClientTextMessage | ClientPingMessage;

// ==========================================
// 服务端 → 客户端
// ==========================================

/** LLM 流式文本片段 */
export interface ServerLlmChunkMessage {
  type: 'llm_chunk';
  sessionId: string;
  text: string;
  sentenceId?: number;
  isFinal: boolean;
  timestamp: number;
}

/** LLM 流结束（携带完整文本便于客户端存档） */
export interface ServerLlmEndMessage {
  type: 'llm_end';
  sessionId: string;
  fullText: string;
  timestamp: number;
}

/** 心跳响应 */
export interface ServerPongMessage {
  type: 'pong';
  sessionId: string;
  timestamp: number;
}

/** 错误消息 */
export type ServerErrorCode =
  | 'INVALID_MESSAGE'
  | 'UNAUTHORIZED'
  | 'RATE_LIMIT'
  | 'ASR_FAILED'
  | 'LLM_FAILED'
  | 'TTS_FAILED'
  | 'INTERNAL_ERROR'
  | 'SESSION_NOT_FOUND';

export interface ServerErrorMessage {
  type: 'error';
  sessionId?: string;
  message: string;
  code: ServerErrorCode;
  timestamp: number;
}

export type ServerMessage =
  | ServerLlmChunkMessage
  | ServerLlmEndMessage
  | ServerPongMessage
  | ServerErrorMessage;

// ==========================================
// 反序列化（D6 类型安全：类型守卫，禁 any）
// ==========================================

/** 校验并窄化服务端消息；不合法返回 null（静默丢弃，不让非法消息击垮 UI） */
export function parseServerMessage(raw: string): ServerMessage | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) return null;
  const obj = parsed as Record<string, unknown>;

  switch (obj.type) {
    case 'llm_chunk':
      return typeof obj.text === 'string' && typeof obj.isFinal === 'boolean'
        ? (obj as unknown as ServerLlmChunkMessage)
        : null;
    case 'llm_end':
      return typeof obj.fullText === 'string' ? (obj as unknown as ServerLlmEndMessage) : null;
    case 'pong':
      return (obj as unknown as ServerPongMessage);
    case 'error':
      return typeof obj.message === 'string' && typeof obj.code === 'string'
        ? (obj as unknown as ServerErrorMessage)
        : null;
    default:
      return null;
  }
}
