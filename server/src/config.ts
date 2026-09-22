import 'dotenv/config';

/**
 * 服务端配置（统一从环境变量读取，遵循 D3 配置驱动原则）
 * - 真实 Key 来自 server/.env（已 .gitignore）
 * - 模板见 server/.env.example
 * - 禁止硬编码任何 Key（违反 D12 Key 安全）
 */
export const config = {
  server: {
    port: Number(process.env.PORT) || 8080,
    host: process.env.HOST || '0.0.0.0',
  },
  // 智谱 LLM（OpenAI 兼容接口，glm-4.7-flash 永久免费）
  zhipu: {
    apiKey: process.env.ZHIPU_API_KEY || '',
    baseURL: process.env.ZHIPU_BASE_URL || 'https://open.bigmodel.cn/api/paas/v4/',
    model: process.env.ZHIPU_MODEL || 'glm-4.7-flash',
  },
  // 讯飞 ASR（语音听写 WebAPI）
  xunfeiAsr: {
    appId: process.env.XUNFEI_APP_ID || '',
    apiKey: process.env.XUNFEI_ASR_API_KEY || '',
    apiSecret: process.env.XUNFEI_ASR_API_SECRET || '',
  },
  // 讯飞 TTS（在线语音合成 WebAPI）
  xunfeiTts: {
    appId: process.env.XUNFEI_APP_ID || '',
    apiKey: process.env.XUNFEI_TTS_API_KEY || '',
    apiSecret: process.env.XUNFEI_TTS_API_SECRET || '',
  },
  // TTS 后端选择：xunfei（默认） | edge（备用免 Key）
  ttsBackend: (process.env.TTS_BACKEND || 'xunfei') as 'xunfei' | 'edge',
  // 音频参数（T1.7 流式管线使用）
  audio: {
    sampleRate: 16000,
    channels: 1,
    bitsPerSample: 16,
    chunkMs: 200,
  },
  // VAD 参数
  //   - silenceMs: 客户端静音断句（T2.2 使用）
  //   - vadEosMs: 讯飞服务端 vad_eos 参数（0-10000ms，默认 2000ms，本项目设 800ms）
  vad: {
    silenceMs: Number(process.env.VAD_SILENCE_MS) || 800,
    vadEosMs: Number(process.env.VAD_EOS_MS) || 800,
  },
} as const;

/**
 * 启动时校验关键配置
 * - 骨架阶段：缺失仅警告不阻塞
 * - 阶段一 T1.8 真实链路自测前必须补齐（届时改为 throw）
 */
export function validateConfig(): void {
  const missing: string[] = [];
  if (!config.zhipu.apiKey) missing.push('ZHIPU_API_KEY（LLM 调用将失败）');
  if (!config.xunfeiAsr.appId) missing.push('XUNFEI_APP_ID（ASR）');
  if (!config.xunfeiAsr.apiKey) missing.push('XUNFEI_ASR_API_KEY');
  if (!config.xunfeiAsr.apiSecret) missing.push('XUNFEI_ASR_API_SECRET');
  if (!config.xunfeiTts.apiKey) missing.push('XUNFEI_TTS_API_KEY');
  if (!config.xunfeiTts.apiSecret) missing.push('XUNFEI_TTS_API_SECRET');

  if (missing.length > 0) {
    // eslint-disable-next-line no-console
    console.warn('[配置警告] 以下环境变量未设置（当前为骨架阶段，T1.8 真实链路自测前必须补齐）：');
    missing.forEach((m) => {
      // eslint-disable-next-line no-console
      console.warn(`  ⚠️  ${m}`);
    });
  } else {
    // eslint-disable-next-line no-console
    console.log('[配置] 全部环境变量已就绪 ✅');
  }
}