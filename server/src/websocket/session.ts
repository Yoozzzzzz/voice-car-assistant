/**
 * 会话管理（T1.2）
 *
 * 职责：
 *   - WebSocket 连接 ↔ 会话（sessionId）的映射
 *   - 会话创建 / 查找 / 移除
 *   - 异常断开时的清理（供 wsServer 回调）
 *
 * 设计说明：
 *   - sessionId 由服务端在连接建立时生成（uuid v4），首次消息由服务端下发？
 *     —— 本协议 sessionId 由客户端在消息中携带，服务端在第一条消息时绑定连接；
 *     若客户端未携带则自动生成并随 pong/error 回传，简化客户端实现。
 *   - 阶段三多实例部署时可替换为 Redis 存储接口（当前单机 Map 足够）
 */
import type { WebSocket } from 'ws';
import { randomUUID } from 'node:crypto';
import { logger } from '../utils/logger.js';

/** 单个客户端会话 */
export interface Session {
  /** 会话唯一 ID */
  sessionId: string;
  /** 对应的 WebSocket 连接 */
  ws: WebSocket;
  /** 创建时间（ms） */
  createdAt: number;
  /** 最后活跃时间（ms），用于超时清理与统计 */
  lastActiveAt: number;
  /** 最近一次心跳（应用层 ping）时间 */
  lastPingAt: number;
  /** 收到的音频分片计数（T1.4/T1.7 使用） */
  audioChunkCount: number;
  /** 收到的文本消息计数（调试统计） */
  textMessageCount: number;
}

/**
 * 会话管理器（单机版）
 *
 * D6 强制：禁用 any；D8 错误边界：所有公开方法不抛异常
 */
export class SessionManager {
  /** sessionId → Session */
  private readonly sessions = new Map<string, Session>();

  /** 为新连接创建会话；若客户端首条消息携带 sessionId 则复用（重连场景） */
  createSession(ws: WebSocket, clientSessionId?: string): Session {
    // 重连复用：旧连接若还挂着，先踢掉（同一会话不允许双连接）
    if (clientSessionId && this.sessions.has(clientSessionId)) {
      const old = this.sessions.get(clientSessionId);
      if (old && old.ws !== ws && old.ws.readyState === old.ws.OPEN) {
        logger.warn({ sessionId: clientSessionId }, '检测到同 sessionId 的新连接，踢掉旧连接');
        old.ws.close(4000, 'replaced by new connection');
      }
    }
    const sessionId = clientSessionId ?? randomUUID();
    const session: Session = {
      sessionId,
      ws,
      createdAt: Date.now(),
      lastActiveAt: Date.now(),
      lastPingAt: Date.now(),
      audioChunkCount: 0,
      textMessageCount: 0,
    };
    this.sessions.set(sessionId, session);
    logger.info({ sessionId, total: this.sessions.size }, '会话建立');
    return session;
  }

  /** 查找会话（不存在返回 undefined，不抛异常） */
  getSession(sessionId: string): Session | undefined {
    return this.sessions.get(sessionId);
  }

  /** 通过 WebSocket 连接反查会话（消息入口用） */
  getSessionByWs(ws: WebSocket): Session | undefined {
    for (const session of this.sessions.values()) {
      if (session.ws === ws) return session;
    }
    return undefined;
  }

  /** 触碰活跃时间（每条消息调用） */
  touch(session: Session): void {
    session.lastActiveAt = Date.now();
  }

  /** 移除会话（断开连接时调用，幂等） */
  removeSession(sessionId: string): void {
    if (this.sessions.delete(sessionId)) {
      logger.info({ sessionId, total: this.sessions.size }, '会话移除');
    }
  }

  /** 清理指定连接关联的会话（异常断开兜底） */
  removeSessionByWs(ws: WebSocket): void {
    const session = this.getSessionByWs(ws);
    if (session) this.removeSession(session.sessionId);
  }

  /** 当前会话数（健康检查/监控用） */
  get size(): number {
    return this.sessions.size;
  }
}
