/**
 * WebSocket 服务端（T1.2）
 *
 * 职责：
 *   - 在 HTTP server 上挂载 /ws 路径的 WebSocket 服务
 *   - 连接建立 / 异常断开清理
 *   - 协议层心跳（ws ping/pong 帧检测死连接）+ 应用层心跳超时（protocol.ts 约定 60s）
 *   - 消息入口：转交 handler.handleMessage 分发
 *
 * 心跳双层设计：
 *   - 协议层：每 30s 发 ws ping 帧，未回 pong 帧则视为死连接断开（穿透 NAT/代理常用）
 *   - 应用层：客户端按协议发 ping 消息，服务端回 pong；超过 60s 无应用层心跳也断开
 */
import type { Server as HttpServer } from 'node:http';
import { WebSocketServer, type WebSocket } from 'ws';
import { WS_PATH, HEARTBEAT_INTERVAL_MS, HEARTBEAT_TIMEOUT_MS } from './protocol.js';
import { SessionManager } from './session.js';
import { handleMessage } from './handler.js';
import { logger } from '../utils/logger.js';

/** 会话管理器（导出供健康检查/监控扩展使用） */
export const sessionManager = new SessionManager();

/** 每个连接的活跃标记（协议层心跳用） */
const aliveFlags = new WeakMap<WebSocket, boolean>();

/**
 * 初始化 WebSocket 服务并挂载到 HTTP server
 * @returns WebSocketServer 实例（供优雅关闭时 terminate）
 */
export function initWebSocketServer(httpServer: HttpServer): WebSocketServer {
  const wss = new WebSocketServer({ server: httpServer, path: WS_PATH });

  // ---------- 协议层心跳：定时 ping，无 pong 则断开 ----------
  const heartbeatTimer = setInterval(() => {
    for (const ws of wss.clients) {
      if (aliveFlags.get(ws) === false) {
        ws.terminate(); // 死连接：直接掐断，触发 close 清理
        continue;
      }
      aliveFlags.set(ws, false);
      ws.ping(); // 发协议层 ping 帧，on('pong') 里恢复标记
    }
  }, HEARTBEAT_INTERVAL_MS);
  heartbeatTimer.unref(); // 不阻止进程退出

  // ---------- 应用层心跳超时：60s 无 ping 消息则断开 ----------
  const appHeartbeatTimer = setInterval(() => {
    const now = Date.now();
    for (const ws of wss.clients) {
      const session = sessionManager.getSessionByWs(ws);
      if (session && now - session.lastPingAt > HEARTBEAT_TIMEOUT_MS) {
        logger.warn({ sessionId: session.sessionId }, '应用层心跳超时，断开连接');
        ws.close(4001, 'heartbeat timeout');
      }
    }
  }, HEARTBEAT_INTERVAL_MS);
  appHeartbeatTimer.unref();

  // ---------- 连接生命周期 ----------
  wss.on('connection', (ws, req) => {
    aliveFlags.set(ws, true);
    logger.info({ ip: req.socket.remoteAddress, url: req.url }, '新 WebSocket 连接');

    // 协议层 pong 帧：恢复活跃标记
    ws.on('pong', () => {
      aliveFlags.set(ws, true);
    });

    // 消息入口（handler 内部全量 try-catch，保证不崩）
    ws.on('message', (data) => {
      // ws 库收到的 data 可能是 Buffer[]，统一转字符串
      const raw = Array.isArray(data) ? data.join('') : String(data);
      handleMessage(sessionManager, ws, raw);
    });

    // 断开清理（正常关闭与异常断开都走这里）
    ws.on('close', (code, reason) => {
      sessionManager.removeSessionByWs(ws);
      logger.info({ code, reason: reason.toString() }, 'WebSocket 连接关闭');
    });

    // 错误兜底：记录日志，不让单个连接的错误击垮进程（D8）
    ws.on('error', (err) => {
      logger.error({ err }, 'WebSocket 连接错误');
      sessionManager.removeSessionByWs(ws);
      ws.terminate();
    });
  });

  // wss 级错误兜底
  wss.on('error', (err) => {
    logger.error({ err }, 'WebSocket 服务错误');
  });

  logger.info(`🔌 WebSocket 服务已挂载: ${WS_PATH}（心跳 ${HEARTBEAT_INTERVAL_MS / 1000}s / 超时 ${HEARTBEAT_TIMEOUT_MS / 1000}s）`);
  return wss;
}

/** 优雅关闭：断开所有客户端并停掉心跳定时器（index.ts shutdown 时调用） */
export function shutdownWebSocket(wss: WebSocketServer): void {
  for (const ws of wss.clients) {
    ws.close(1001, 'server shutting down');
  }
  wss.close();
  logger.info('WebSocket 服务已关闭');
}
