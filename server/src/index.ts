/**
 * Server 入口（阶段零骨架）
 *
 * 当前职责：
 *   - 加载配置 + 启动校验
 *   - HTTP 健康检查（K8s/PM2 探针用）
 *   - 优雅关闭（SIGTERM/SIGINT）
 *
 * 阶段一将接入：
 *   - WebSocket 服务（T1.2）→ 挂载 /ws 路径
 *   - 智谱 LLM 流式客户端（T1.3）
 *   - 讯飞 ASR 流式听写（T1.4）
 *   - 讯飞 TTS / Edge TTS 按句合成（T1.5/T1.6）
 *   - 流式管线编排 ASR→LLM→TTS（T1.7）
 */
import 'dotenv/config';
import express from 'express';
import { logger } from './utils/logger.js';
import { config, validateConfig } from './config.js';
import { initWebSocketServer, shutdownWebSocket, sessionManager } from './websocket/wsServer.js';
import { getActiveLlmProvider } from './services/llmService.js';
import { getSystemPromptMeta } from './prompts/systemPrompt.js';

// 启动校验：缺失 Key 仅警告不阻塞（骨架阶段允许，阶段一联调前必须补齐）
validateConfig();

const app = express();
const PORT = config.server.port;
const HOST = config.server.host;

// 中间件：JSON 解析
app.use(express.json());

// 健康检查（含 WebSocket 会话数）
app.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    timestamp: Date.now(),
    uptime: Math.round(process.uptime()),
    wsSessions: sessionManager.size,
    // 当前激活的 LLM 供应商与模型（切换 LLM_PROVIDER 后重启生效）
    llm: getActiveLlmProvider(),
    // 系统提示词来源与长度（外置 md：server/prompts/system-prompt.md，用于确认加载的是哪份提示词）
    systemPrompt: getSystemPromptMeta(),
  });
});

// 服务信息端点（调试用）
app.get('/', (_req, res) => {
  res.json({
    name: 'voice-car-assistant-server',
    version: '0.1.0',
    stage: 'stage1-ws-server',
    endpoints: ['/health', '/ws'],
    nodeVersion: process.version,
  });
});

// 404 兜底
app.use((req, res) => {
  res.status(404).json({ error: 'Not Found', path: req.path });
});

// 启动 HTTP 服务，并挂载 WebSocket（T1.2）
const server = app.listen(PORT, HOST, () => {
  logger.info(`🚀 Server started on http://${HOST}:${PORT}`);
  logger.info(`   Health: http://${HOST}:${PORT}/health`);
  logger.info(`   Stage:  一（WebSocket 服务就绪）`);
});
const wss = initWebSocketServer(server);

// 优雅关闭（D8 错误边界）
const shutdown = (signal: string): void => {
  logger.info(`Received ${signal}, shutting down gracefully...`);
  shutdownWebSocket(wss); // 先关 WebSocket（通知客户端 + 停心跳定时器）
  server.close(() => {
    logger.info('HTTP server closed');
    process.exit(0);
  });
  // 强制退出兜底（10s 内未关闭则强杀）
  setTimeout(() => {
    logger.error('Forced shutdown after 10s timeout');
    process.exit(1);
  }, 10_000).unref();
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

// 未处理异常兜底（避免进程静默崩溃）
process.on('unhandledRejection', (reason) => {
  logger.error({ reason }, 'Unhandled Promise Rejection');
});
process.on('uncaughtException', (err) => {
  logger.error({ err }, 'Uncaught Exception');
  shutdown('uncaughtException');
});

export default server;