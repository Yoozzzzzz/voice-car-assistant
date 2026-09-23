/**
 * WebSocket 通信协议（T1.1 冻结）
 *
 * 基于《项目文档》3.2 协议定义扩展而来，相对原文档的差异：
 *   1. 客户端增加 control（recording_start/end）与 ping 心跳消息
 *   2. 服务端 llm_chunk 增加 sentenceId 字段，配合 T1.7 流式管线按句切分 TTS
 *   3. 服务端 tts_audio 明确音频格式：WAV 头（44字节）+ PCM 16kHz/16bit/单声道，base64 编码
 *   4. 新增 error 消息类型 + ErrorCode 错误码约定
 *   5. 新增 SessionConfig 会话级配置常量
 *
 * D6 强制：所有消息按 interface 定义，禁用 any；序列化工具有类型守卫
 *
 * 阶段二车机端必须严格按本协议实现（T2.3），协议变更需同步更新《项目文档》+ 本文件 + docs/API.md
 */

// ==========================================
// 常量
// ==========================================

/** WebSocket 路径 */
export const WS_PATH = '/ws';

/** 音频采样率（Hz） */
export const SAMPLE_RATE = 16000;

/** 音频通道数（单声道） */
export const CHANNELS = 1;

/** 采样位深 */
export const BITS_PER_SAMPLE = 16;

/** 客户端音频分片时长（ms），每 200ms 一个 chunk */
export const CHUNK_MS = 200;

/** 心跳间隔（ms） */
export const HEARTBEAT_INTERVAL_MS = 30_000;

/** 心跳超时（ms），超时无 pong 则断开 */
export const HEARTBEAT_TIMEOUT_MS = 60_000;

/** WAV 头字节数 */
export const WAV_HEADER_BYTES = 44;

// ==========================================
// 错误码
// ==========================================

export type ErrorCode =
  | 'INVALID_MESSAGE'        // 非法消息格式（JSON 解析失败/字段缺失/type 不识别）
  | 'UNAUTHORIZED'           // 未授权（预留：未来加鉴权）
  | 'RATE_LIMIT'             // 限流
  | 'ASR_FAILED'             // 讯飞 ASR 失败
  | 'LLM_FAILED'             // 智谱 LLM 失败
  | 'TTS_FAILED'             // TTS 失败（含讯飞 + Edge 双后端降级后仍失败）
  | 'INTERNAL_ERROR'         // 服务端内部错误（兜底）
  | 'SESSION_NOT_FOUND';     // 会话不存在（异常断开后客户端未感知）

// ==========================================
// 客户端 → 服务端
// ==========================================

export type ClientMessageType = 'audio' | 'text' | 'control' | 'ping';

/**
 * 音频分片消息（每 200ms 一个 PCM chunk）
 *   - data: base64 编码的 PCM（16kHz/16bit/单声道，200ms ≈ 6400 字节）
 *   - isLast: 当前会话最后一个分片（标记一轮语音结束，配合 asr.end_vad 触发 LLM）
 */
export interface ClientAudioMessage {
  type: 'audio';
  sessionId: string;
  seq: number;          // 序号（0 开始递增；重连时 client 据此判断丢包）
  data: string;         // PCM base64
  isLast: boolean;      // 是否本轮最后一个分片（替代 control.recording_end 的语义）
  timestamp: number;
}

/**
 * 文本直传消息（调试用，绕过 ASR 直接传文本给 LLM）
 */
export interface ClientTextMessage {
  type: 'text';
  sessionId: string;
  data: string;         // 纯文本
  timestamp: number;
}

/**
 * 控制消息（保留扩展位；常规流程用 audio.isLast 标记本轮结束已足够）
 *   - new_conversation: 开启新对话（清除服务端会话历史），对应车机"每次唤醒 = 新对话"语义
 */
export interface ClientControlMessage {
  type: 'control';
  sessionId: string;
  action: 'recording_start' | 'recording_end' | 'interrupt' | 'new_conversation';
  timestamp: number;
}

/**
 * 心跳消息
 */
export interface ClientPingMessage {
  type: 'ping';
  sessionId: string;
  timestamp: number;
}

export type ClientMessage =
  | ClientAudioMessage
  | ClientTextMessage
  | ClientControlMessage
  | ClientPingMessage;

// ==========================================
// 服务端 → 客户端
// ==========================================

export type ServerMessageType =
  | 'asr_result'    // ASR 识别结果（中间/最终）
  | 'llm_chunk'     // LLM 流式文本片段
  | 'llm_end'       // LLM 流结束（含完整文本）
  | 'llm_retry'     // LLM 429 限流重试进度通知（2026-09-23 新增）
  | 'tts_audio'     // TTS 音频（按句：每句 1 条消息，独立可播放）
  | 'conversation_reset' // 新对话确认（2026-09-23 新增）
  | 'pong'          // 心跳响应
  | 'error';        // 错误

/**
 * ASR 识别结果
 *   - isFinal=true 触发 LLM 调用（T1.7 流式管线编排）
 *   - 讯飞 vad_eos 触发 / 客户端 audio.isLast 触发
 */
export interface ServerAsrResultMessage {
  type: 'asr_result';
  sessionId: string;
  text: string;            // 识别文本（中间或最终）
  isFinal: boolean;        // 是否最终结果
  timestamp: number;
}

/**
 * LLM 流式文本片段
 *   - T1.7 遇句末标点（，。！？）立即触发该句 TTS，不等流收完
 *   - sentenceId 用于与 tts_audio 配对
 */
export interface ServerLlmChunkMessage {
  type: 'llm_chunk';
  sessionId: string;
  text: string;            // 本次增量文本
  sentenceId?: number;     // 句 ID（若该 chunk 完整包含一个或多个句末标点，则附 sentenceId）
  isFinal: boolean;        // 是否本轮最后一个 chunk
  timestamp: number;
}

/**
 * LLM 流结束（携带完整文本便于客户端存档）
 */
export interface ServerLlmEndMessage {
  type: 'llm_end';
  sessionId: string;
  fullText: string;        // 完整回复
  timestamp: number;
}

/**
 * LLM 429 限流重试进度通知
 *   - 服务端指数退避重试期间逐次下发，客户端展示"正在重试（N/M）"
 *   - 重试成功后正常进入 llm_chunk/llm_end；耗尽后下发 error(LLM_FAILED) 附失败原因
 */
export interface ServerLlmRetryMessage {
  type: 'llm_retry';
  sessionId: string;
  retry: number;          // 第几次重试（从 1 开始）
  maxRetries: number;     // 最大重试次数
  timestamp: number;
}

/**
 * TTS 音频（按句）
 *   - 格式：WAV 头（44 字节）+ PCM 16kHz/16bit/单声道，base64 编码
 *   - 客户端可立即播放，无需等所有 TTS 完成（延迟达标关键）
 */
export interface ServerTtsAudioMessage {
  type: 'tts_audio';
  sessionId: string;
  sentenceId: number;      // 句 ID，对应 llm_chunk.sentenceId
  audio: string;           // WAV + PCM，base64
  durationMs: number;      // 该句音频时长
  isFinal: boolean;        // 是否最后一帧（通常单帧即最终）
  timestamp: number;
}

/**
 * 新对话确认（服务端收到 control.new_conversation 并清除历史后回执）
 */
export interface ServerConversationResetMessage {
  type: 'conversation_reset';
  sessionId: string;
  timestamp: number;
}

/**
 * 心跳响应
 */
export interface ServerPongMessage {
  type: 'pong';
  sessionId: string;
  timestamp: number;
}

/**
 * 错误消息
 */
export interface ServerErrorMessage {
  type: 'error';
  sessionId?: string;      // 错误可能发生在握手前，sessionId 可选
  message: string;         // 人类可读
  code: ErrorCode;         // 错误码（客户端可据此降级）
  timestamp: number;
}

export type ServerMessage =
  | ServerAsrResultMessage
  | ServerLlmChunkMessage
  | ServerLlmEndMessage
  | ServerLlmRetryMessage
  | ServerTtsAudioMessage
  | ServerConversationResetMessage
  | ServerPongMessage
  | ServerErrorMessage;

// ==========================================
// 会话配置（用于握手响应或配置同步）
// ==========================================

export interface SessionConfig {
  sampleRate: typeof SAMPLE_RATE;
  channels: typeof CHANNELS;
  bitsPerSample: typeof BITS_PER_SAMPLE;
  chunkMs: typeof CHUNK_MS;
  ttsBackend: 'xunfei' | 'edge';  // 当前服务端 TTS 后端
}

// ==========================================
// 客户端协议版本（未来升级用）
// ==========================================

export const PROTOCOL_VERSION = '1.0.0';