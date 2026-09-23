/**
 * WebSocket 客户端服务（T2.3 基础版）
 *
 * 职责：
 *   - 建立到后端的 WS 连接（RN 内置 WebSocket，无需第三方库）
 *   - 应用层心跳（25s 一次 ping，服务端 60s 无心跳会断开）
 *   - 发送文本消息（调试通道：text → LLM 流式回复）
 *   - 状态回调（连接/断开）与消息回调（llm_chunk/llm_end/error/pong）
 *
 * 不负责：自动重连（T2.4 useAutoReconnect 接管）、音频收发（T2.1/T2.5）。
 * D8 错误边界：所有回调包 try-catch，异常只打 console 不抛出。
 */
import { HEARTBEAT_INTERVAL_MS } from '../config';
import { parseServerMessage, type ClientMessage, type ServerMessage } from './protocol';

/** 连接状态 */
export type WsStatus = 'disconnected' | 'connecting' | 'connected';

/** 生成会话 ID（app 启动一次，重连复用，服务端据此绑定会话） */
function generateSessionId(): string {
  return `c-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export class WebSocketService {
  private ws: WebSocket | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private statusCb: ((status: WsStatus) => void) | null = null;
  private messageCb: ((msg: ServerMessage) => void) | null = null;
  /** 会话 ID：创建后固定，重连复用（服务端同 sessionId 踢旧连接） */
  public readonly sessionId = generateSessionId();

  /** 当前是否已连接 */
  get connected(): boolean {
    return this.ws !== null && this.ws.readyState === WebSocket.OPEN;
  }

  /** 订阅连接状态变化 */
  onStatusChange(cb: (status: WsStatus) => void): void {
    this.statusCb = cb;
  }

  /** 订阅服务端消息 */
  onMessage(cb: (msg: ServerMessage) => void): void {
    this.messageCb = cb;
  }

  /** 建立连接（已连接时忽略） */
  connect(url: string): void {
    if (this.connected) return;
    // statusCb 为 null 说明组件尚未订阅（未挂载），不建连
    if (this.statusCb === null) return;
    this.cleanup();
    this.emitStatus('connecting');
    try {
      const ws = new WebSocket(url);
      this.ws = ws;
      ws.onopen = () => {
        this.emitStatus('connected');
        this.startHeartbeat();
      };
      ws.onmessage = (event: WebSocketMessageEvent) => {
        const msg = parseServerMessage(String(event.data));
        if (msg && this.messageCb) {
          try {
            this.messageCb(msg);
          } catch (err) {
            console.error('[ws] 消息回调异常', err);
          }
        }
      };
      ws.onclose = () => {
        this.stopHeartbeat();
        this.emitStatus('disconnected');
      };
      ws.onerror = () => {
        // onclose 会紧随触发，统一在那里收敛状态
        console.warn('[ws] 连接错误');
      };
    } catch (err) {
      console.error('[ws] 创建连接失败', err);
      this.emitStatus('disconnected');
    }
  }

  /** 主动断开 */
  disconnect(): void {
    this.cleanup();
    this.emitStatus('disconnected');
  }

  /** 发送文本消息（调试通道 → LLM）；未连接返回 false */
  sendText(text: string): boolean {
    return this.send({ type: 'text', sessionId: this.sessionId, data: text, timestamp: Date.now() });
  }

  /** 开启新对话（清除服务端会话历史，对应车机"每次唤醒 = 新对话"）；未连接返回 false */
  startNewConversation(): boolean {
    return this.send({
      type: 'control',
      sessionId: this.sessionId,
      action: 'new_conversation',
      timestamp: Date.now(),
    });
  }

  /** 序列化并发送（内部通用） */
  private send(msg: ClientMessage): boolean {
    if (!this.connected || this.ws === null) return false;
    try {
      this.ws.send(JSON.stringify(msg));
      return true;
    } catch (err) {
      console.error('[ws] 发送失败', err);
      return false;
    }
  }

  /** 应用层心跳：立即发一次 + 定时 25s（服务端 60s 超时） */
  private startHeartbeat(): void {
    this.send({ type: 'ping', sessionId: this.sessionId, timestamp: Date.now() });
    this.stopHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      this.send({ type: 'ping', sessionId: this.sessionId, timestamp: Date.now() });
    }, HEARTBEAT_INTERVAL_MS);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer !== null) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  /** 清理连接与定时器（不断开外部订阅） */
  private cleanup(): void {
    this.stopHeartbeat();
    if (this.ws !== null) {
      // 置空回调避免 onclose 再触发状态回调（主动断开场景由调用方收敛状态）
      const ws = this.ws;
      ws.onopen = null;
      ws.onclose = null;
      ws.onerror = null;
      ws.onmessage = null;
      try {
        ws.close();
      } catch {
        // 忽略：可能已关闭
      }
      this.ws = null;
    }
  }

  private emitStatus(status: WsStatus): void {
    try {
      this.statusCb?.(status);
    } catch (err) {
      console.error('[ws] 状态回调异常', err);
    }
  }
}
