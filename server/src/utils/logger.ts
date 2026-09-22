import pino from 'pino';

/**
 * 全局日志器
 * - dev 环境（NODE_ENV != production）：pino-pretty 彩色输出
 * - prod 环境：JSON 结构化（便于日志聚合如 ELK/Loki）
 */
const isDev = process.env.NODE_ENV !== 'production';

export const logger = pino({
  level: process.env.LOG_LEVEL || (isDev ? 'debug' : 'info'),
  transport: isDev
    ? {
        target: 'pino-pretty',
        options: {
          colorize: true,
          translateTime: 'SYS:HH:MM:ss.l',
          ignore: 'pid,hostname',
        },
      }
    : undefined,
});