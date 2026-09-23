/**
 * 智谱 LLM 流式客户端（T1.3）
 *
 * D11 核实结论（2026-09-22 web 搜索）：
 *   - GLM-4.7-Flash：2026-01-20 发布，永久免费（无 Token 上限），MIT 开源
 *   - OpenAI 兼容接口：baseURL https://open.bigmodel.cn/api/paas/v4/，chat/completions + SSE 流式
 *   - 混合思考模型：流式 delta 中可能携带 reasoning_content（思考过程），正文在 content
 *   - **免费 API 限 1 个并发请求** → 本模块实现全局请求互斥（串行队列）
 *
 * 职责（单一）：
 *   - 封装智谱 LLM 的流式调用（openai SDK 指向 bigmodel baseURL）
 *   - 过滤 reasoning_content（思考过程不入正文，不发给 TTS）
 *   - 全局并发互斥（1 并发限制）+ 请求超时 + 统一错误映射 LLM_FAILED
 *
 * 不负责：会话历史管理（T1.7 管线负责）、按句切分（T1.7）、消息下发（handler 负责）
 */
import OpenAI from 'openai';
import { config } from '../config.js';
import { logger } from '../utils/logger.js';

/** 对话消息（LLM 视角，OpenAI 格式） */
export interface LlmMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

/**
 * 车机语音助手系统提示词
 *
 * 设计要点：
 *   - 口语化短句（TTS 按句合成，短句显著降低首句延迟）
 *   - 规范句末标点（，。！？），T1.7 按标点切分触发 TTS
 *   - 拒绝长列表/代码块（语音播报不友好）
 */
export const SYSTEM_PROMPT = [
  '你是车载语音助手，通过语音与驾驶员对话。',
  '回答必须口语化、简洁，每次不超过 3 句话，单句不超过 25 个字。',
  '正确使用句末标点（。！？）和逗号，不要使用 emoji、markdown、列表或代码块。',
  '涉及驾驶安全（疲劳、路况、天气）时主动简短提醒。',
  '无法确定的信息要明确说明，不要编造。',
].join('');

/** 流式回调集合 */
export interface StreamCallbacks {
  /** 每收到一段正文增量（已过滤思考内容） */
  onDelta: (text: string) => void;
  /** 429 限流重试进度通知（第 retry 次重试 / 共 maxRetries 次），供客户端展示"重试中(N/M)" */
  onRetry?: (retry: number, maxRetries: number) => void;
}

/** 429 限流最大重试次数（不含首次请求；总尝试 = 1 + MAX_RETRIES） */
const MAX_RETRIES = 3;

/** 重试基础间隔（ms），指数退避：800 → 1600 → 3200 */
const RETRY_BASE_MS = 800;

/** 调用结果 */
export interface LlmResult {
  /** 完整正文（不含思考过程） */
  fullText: string;
  /** 本次调用耗时（ms，含排队） */
  elapsedMs: number;
}

/** LLM 业务错误（携带可下发给客户端的原因） */
export class LlmError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(message);
    this.name = 'LlmError';
  }
}

// ==========================================
// OpenAI 客户端（指向智谱 baseURL）
// ==========================================

const client = new OpenAI({
  apiKey: config.zhipu.apiKey || 'missing-key',
  baseURL: config.zhipu.baseURL,
  // glm-4.7-flash 首字延迟通常 <1s，整体 60s 超时兜底足够
  timeout: 60_000,
  maxRetries: 1, // 流式请求失败重试一次（幂等性：失败发生在开头才重试，SDK 保证）
});

// ==========================================
// 全局并发互斥（免费 API 限 1 并发）
// ==========================================

let queueTail: Promise<void> = Promise.resolve();

/** 串行执行：同一时刻最多 1 个 LLM 请求在途 */
async function serialized<T>(task: () => Promise<T>): Promise<T> {
  const prev = queueTail;
  let release: () => void;
  queueTail = new Promise((resolve) => {
    release = resolve;
  });
  await prev; // 等前一个请求完成
  try {
    return await task();
  } finally {
    release!();
  }
}

// ==========================================
// 核心接口
// ==========================================

/**
 * 流式请求 LLM 回复
 *
 * @param userText 用户本轮输入（ASR 最终文本或调试文本）
 * @param history 此前的对话历史（不含本轮输入；由 T1.7 管线维护）
 * @param callbacks.onDelta 正文增量回调（T1.7 在此做按句切分 + 下发 llm_chunk）
 * @param signal 中断信号（客户端 interrupt 时 T1.7 触发）
 * @returns 完整正文与耗时；失败抛 LlmError（调用方映射 error(LLM_FAILED)）
 */
/** 是否 429 限流可重试 */
function isRateLimitError(err: unknown): boolean {
  if (err instanceof OpenAI.APIError && err.status === 429) return true;
  if (err instanceof Error) {
    const m = err.message;
    return m.includes('429') || m.includes('访问量过大') || m.includes('rate_limit') || m.includes('Rate limit');
  }
  return false;
}

/** 指数退避等待 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function streamLlmReply(
  userText: string,
  history: LlmMessage[],
  callbacks: StreamCallbacks,
  signal?: AbortSignal,
): Promise<LlmResult> {
  const startMs = Date.now();

  if (!config.zhipu.apiKey) {
    throw new LlmError('ZHIPU_API_KEY 未配置（server/.env）');
  }

  const messages: LlmMessage[] = [
    { role: 'system', content: SYSTEM_PROMPT },
    ...history,
    { role: 'user', content: userText },
  ];

  let lastErr: unknown;
  // 总尝试 = 1 次首请求 + MAX_RETRIES 次重试（仅 429 限流触发重试）
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt += 1) {
    if (signal?.aborted) {
      logger.info('LLM 请求被中断（客户端 interrupt），停止重试');
      return { fullText: '', elapsedMs: Date.now() - startMs };
    }

    try {
      return await serialized(async () => {
        let fullText = '';
        let reasoningChars = 0;

        // 智谱扩展参数：关闭思维链（D11 核实 2026-09-22 官方文档）
        //   - thinking.type 仅 enabled/disabled，默认 enabled，GLM-4.7 开启后强制思考
        //   - 思考内容与正文共用 max_tokens 输出额度（实测 872 字思考耗尽 512 上限导致正文为空）
        //   - 车机低延迟场景必须禁用；openai SDK 类型不含此字段，故基础参数走标准类型、扩展字段后置断言透传
        const baseParams: OpenAI.Chat.ChatCompletionCreateParamsStreaming = {
          model: config.zhipu.model,
          messages,
          stream: true,
          // 思考已禁用，此上限仅约束正文；官方建议 >=1024
          max_tokens: 1024,
          temperature: 0.7,
        };
        const params = {
          ...baseParams,
          thinking: { type: 'disabled' },
        } as OpenAI.Chat.ChatCompletionCreateParamsStreaming;

        const stream = await client.chat.completions.create(params, { signal });

        for await (const chunk of stream) {
          // 思考过程（混合思考模型）：忽略，不进正文
          const reasoning = (chunk.choices[0]?.delta as { reasoning_content?: string } | undefined)
            ?.reasoning_content;
          if (reasoning) {
            reasoningChars += reasoning.length;
            continue;
          }

          const delta = chunk.choices[0]?.delta?.content;
          if (delta) {
            fullText += delta;
            callbacks.onDelta(delta);
          }
        }

        if (reasoningChars > 0) {
          logger.debug({ reasoningChars }, 'LLM 思考过程已过滤');
        }

        return { fullText, elapsedMs: Date.now() - startMs };
      });
    } catch (err) {
      // 中断不算错误，正常返回空结果由调用方处理
      if (signal?.aborted || (err instanceof Error && err.name === 'AbortError')) {
        logger.info('LLM 请求被中断（客户端 interrupt）');
        return { fullText: '', elapsedMs: Date.now() - startMs };
      }
      lastErr = err;
      if (isRateLimitError(err) && attempt < MAX_RETRIES) {
        const retry = attempt + 1; // 第几次重试（1 开始）
        const delay = RETRY_BASE_MS * 2 ** attempt;
        logger.warn({ retry, maxRetries: MAX_RETRIES, delay }, 'LLM 429 限流，自动指数退避重试');
        // 通知客户端重试进度（展示"重试中(N/M)"）
        try {
          callbacks.onRetry?.(retry, MAX_RETRIES);
        } catch {
          // 回调异常不影响重试流程
        }
        await sleep(delay);
        continue;
      }
      // 非 429 或重试耗尽：包装为 LlmError 抛出（附人类可读失败原因）
      const msg = err instanceof Error ? err.message : String(err);
      const reason = isRateLimitError(err)
        ? `模型访问量过大（429 限流），已重试 ${MAX_RETRIES} 次仍失败，请稍后再试`
        : `LLM 调用失败: ${msg}`;
      logger.error({ err }, 'LLM 流式调用失败');
      throw new LlmError(reason, err);
    }
  }

  // 不可达保险：循环正常退出路径均被 return/throw 覆盖，兜底抛出最后一次错误
  const msg = lastErr instanceof Error ? lastErr.message : String(lastErr);
  logger.error({ err: lastErr }, 'LLM 流式调用失败（重试耗尽）');
  throw new LlmError(`LLM 调用失败: ${msg}`, lastErr);
}
