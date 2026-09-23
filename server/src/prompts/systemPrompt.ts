/**
 * 系统提示词加载器（2026-09-23 用户要求：提示词外置为 md，改提示词不用改代码）
 *
 * 单一职责：把 `server/prompts/system-prompt.md` 读成纯文本 system 消息正文。
 *
 * 路径解析（开发/生产一致）：
 *   - 开发：src/prompts/systemPrompt.ts → ../../prompts/system-prompt.md
 *   - 生产：dist/prompts/systemPrompt.js → ../../prompts/system-prompt.md
 *   两者目录深度相同（tsc 保持 src 内部结构），故同一相对路径均指向 server/prompts/
 *   - 可用 SYSTEM_PROMPT_FILE 覆盖（绝对路径，或相对 server 启动目录的路径；D3 配置驱动）
 *
 * 容错：文件缺失/读取失败/解析为空 → 回退内置兜底提示词 + warn 日志，绝不因此中断 LLM 链路（D8）
 *
 * 不负责：system 消息拼装（llmService 负责）、多轮历史（T1.7 管线负责）
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from '../config.js';
import { logger } from '../utils/logger.js';

/** 默认提示词文件：<serverRoot>/prompts/system-prompt.md */
const DEFAULT_PROMPT_FILE = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../prompts/system-prompt.md',
);

/**
 * 兜底提示词
 * 仅在 md 文件缺失/为空时使用，与 prompts/system-prompt.md 的正文保持一致的口径
 */
const FALLBACK_PROMPT = [
  '你是车载语音助手，通过语音与驾驶员对话。',
  '回答必须口语化、简洁，每次不超过 3 句话，单句不超过 25 个字。',
  '正确使用句末标点（。！？）和逗号，不要使用 emoji、markdown、列表或代码块。',
  '涉及驾驶安全（疲劳、路况、天气）时主动简短提醒。',
  '无法确定的信息要明确说明，不要编造。',
].join('');

/** 提示词加载结果 */
export interface SystemPromptInfo {
  /** 最终发送给 LLM 的 system 正文 */
  text: string;
  /** 实际加载的文件路径（或 FALLBACK 标记） */
  source: string;
  /** 是否走了兜底（文件缺失/为空） */
  usedFallback: boolean;
}

/**
 * markdown → 纯文本提示词
 *
 * 规则（与 prompts/system-prompt.md 头部注释一致）：
 *   - 去掉 HTML 注释（块注释按行状态机处理，行内出现字面量注释符不会误截断）
 *   - 去掉标题行（# / ## / ...）、引用块（>）、代码块围栏（```）——给人看的结构
 *   - 列表符号（- / * / + / 1. ）去掉，保留条目文本
 *   - 去掉空行，逐行拼接（LLM 能正确处理换行分隔的约束条目）
 *
 * 注：曾用 `/<!--[\s\S]*?-->/g` 整段去注释，会因注释正文中出现字面量 `-->`（如说明"HTML 注释写法"）
 *     被提前截断，导致注释内容漏进提示词（2026-09-23 自测发现），故改为按行状态机。
 */
export function markdownToPrompt(md: string): string {
  const lines: string[] = [];
  let inComment = false;

  for (const rawLine of md.split(/\r?\n/)) {
    let line = rawLine.trim();

    // 块注释：以整行 <!-- 开始、以整行 --> 结束（内部含其它文本的行一律忽略）
    if (inComment) {
      if (line.endsWith('-->')) inComment = false;
      continue;
    }
    if (line.startsWith('<!')) {
      if (!line.endsWith('-->')) inComment = true;
      continue;
    }

    // 行内注释：`前置文本 <!-- 说明 --> 后置文本`
    line = line.replace(/<!--[\s\S]*?-->/g, '').trim();

    if (
      line.length === 0 ||
      line.startsWith('#') ||
      line.startsWith('>') ||
      line.startsWith('```')
    ) {
      continue;
    }
    lines.push(line.replace(/^[-*+]\s+/, '').replace(/^\d+[.)]\s+/, ''));
  }

  return lines.join('\n');
}

/** 解析提示词文件路径（支持环境变量覆盖） */
function resolvePromptPath(): string {
  const override = config.systemPromptFile.trim();
  if (!override) return DEFAULT_PROMPT_FILE;
  return path.isAbsolute(override) ? override : path.resolve(process.cwd(), override);
}

/** 读取 md 文件；失败返回 null（由调用方回退） */
function readPromptFile(file: string): string | null {
  try {
    return readFileSync(file, 'utf8');
  } catch (err) {
    logger.warn(
      { file, err: err instanceof Error ? err.message : String(err) },
      '系统提示词文件读取失败，将使用内置兜底提示词',
    );
    return null;
  }
}

/** 加载系统提示词（进程启动时调用一次） */
export function loadSystemPrompt(): SystemPromptInfo {
  const file = resolvePromptPath();
  const raw = readPromptFile(file);
  const text = raw === null ? '' : markdownToPrompt(raw);

  if (text.length === 0) {
    // 读取失败时上面已 warn 过，这里只报"文件存在但解析为空"的情况，避免重复日志
    if (raw !== null) logger.warn({ file }, '系统提示词文件解析后为空，将使用内置兜底提示词');
    return { text: FALLBACK_PROMPT, source: 'FALLBACK(内置)', usedFallback: true };
  }

  logger.info({ file, chars: text.length, lines: text.split('\n').length }, '系统提示词已加载');
  return { text, source: file, usedFallback: false };
}

/** 启动时加载一次（提示词改动静默重启生效，避免每轮对话重复读盘） */
export const SYSTEM_PROMPT_INFO: SystemPromptInfo = loadSystemPrompt();

/** 系统提示词正文（llmService 拼装 system 消息用） */
export const SYSTEM_PROMPT: string = SYSTEM_PROMPT_INFO.text;

/**
 * 提示词元信息（健康检查用）
 * 只暴露来源与长度，不返回正文，避免 /health 泄露提示词或响应体过大
 */
export function getSystemPromptMeta(): { source: string; chars: number; usedFallback: boolean } {
  return {
    source: SYSTEM_PROMPT_INFO.source,
    chars: SYSTEM_PROMPT_INFO.text.length,
    usedFallback: SYSTEM_PROMPT_INFO.usedFallback,
  };
}
