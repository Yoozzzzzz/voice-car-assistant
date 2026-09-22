# 车机语音问答助手 - 门禁式AI开发规范 + 项目进度跟踪

> **目的**：1人+AI开发后装 Android 车机语音问答软件（React Native 客户端 + Node.js 后端）。本文件定义"门禁式"开发流程，约束 AI 生成代码的质量与节奏，并作为项目进度的唯一事实来源，节约上下文。
> **使用方式**：每完成一项任务，必须更新本文件对应行的状态，并通过验收门禁后才能开始下一项。
> **更新原则**：只追加/修改状态字段，不删除历史记录。每阶段验收后追加验收记录。
> **项目文档**：需求/架构/技术选型以《项目文档.md》为准（RN+Expo 客户端、Node.js 后端、讯飞 ASR/TTS、智谱 GLM-4.7-Flash、WebSocket 全双工流式）。

---

## 第一部分：门禁式AI开发规范

### 1. 门禁总览

```
[任务入口门禁] ──→ [开发过程门禁] ──→ [任务出口门禁] ──→ [验收门禁]
     ↓                  ↓                  ↓                ↓
  开始前检查        开发中约束         完成后自检        正式验收
  不通过不开工      违反即回退         不通过不验收       不通过不合并
```

### 2. 入口门禁（开始任务前必须满足）

| # | 检查项 | 通过标准 |
|---|--------|----------|
| E1 | 任务已分解 | 当前任务有明确的验收标准和产出物 |
| E2 | 相关代码已读 | 已阅读即将修改/扩展的文件，理解现有逻辑 |
| E3 | 依赖已验收 | 前置任务的验收记录已写入本文件 |
| E4 | 设计已确认 | 涉及协议/架构/数据结构决策的，方案已确认（WebSocket 消息协议、流式管线切分策略等） |
| E5 | 配置先行 | 需要新参数（.env 变量/音频参数/VAD 参数/系统 Prompt/服务器地址）的，配置项与 .env.example 已先写好 |

### 3. 开发过程门禁（开发中必须遵守）

| # | 约束 | 说明 |
|---|------|------|
| D1 | 目录规范 | 严格遵循《项目文档》2.3 目录结构（client/src 与 server/src），不乱放文件 |
| D2 | 命名规范 | 类名 PascalCase，函数/变量 camelCase，常量 UPPER_SNAKE，私有 _prefix |
| D3 | 配置驱动 | 音频参数/VAD 阈值/模型名/系统 Prompt/重连参数等放配置文件或 .env，代码只读 |
| D4 | 单一职责 | 单个 .ts 文件不超过 500 行，函数不超过 50 行 |
| D5 | 中文注释 | 公共接口、复杂逻辑（流式管线/VAD/重连状态机）必须有中文注释 |
| D6 | 类型严格 | 禁用 any，interface 优先；WebSocket 消息必须按协议 interface 定义 |
| D7 | 不写 mock | 不伪造 ASR/TTS/LLM 返回值；未拿到 Key 前用明确标注的占位并在本文件记录，不假装链路已通 |
| D8 | 错误边界 | 外部依赖（网络/WebSocket/讯飞/智谱）必须有 try-catch、超时控制与降级路径 |
| D9 | 不破坏旧 | 新增功能不影响已验收功能，如破坏必须先回滚或同步修复 |
| D10 | Git 提交 | 每完成一个子任务提交一次，commit message 用 `feat/fix/docs:` 前缀；.env 永不入库；**每完成一个小节点即 commit + push 到远程（用户要求，2026-09-22）** |
| D11 | 库/API 核实 | 涉及新库/新 API 时**首选 context7 查询**（context7 不可用时 fallback 到 web 搜索/官方文档），核实结论写入开发日志（来源 + 结论）。覆盖三件事：①库选型与版本兼容性；②外部 API 最新签名/参数/限制（讯飞 WebAPI、智谱 OpenAI 兼容接口）；③已知坑（性能、平台限制、不再维护）。**严禁凭训练记忆编造库名/函数名/参数** |
| D12 | Key 安全 | API Key/AppID/Secret 仅存服务端 .env；禁止硬编码、禁止提交仓库、禁止下发到客户端 |

### 4. 出口门禁（完成任务后自检）

| # | 检查项 | 通过标准 |
|---|--------|----------|
| X1 | 功能可运行 | server 端 `npm run dev` 无报错；client 端 Expo 能加载无红屏 |
| X2 | 无控制台警告 | 终端/Metro/浏览器 Console 无 error/warning（允许的第三方警告除外） |
| X3 | 验收点达成 | 本文件中该任务的"验收标准"逐条勾选通过 |
| X4 | 边界测试 | 断网/超时/空音频/超长输入/非法消息格式至少测过一次 |
| X5 | 进度更新 | 本文件对应任务状态已改为 `✅已完成` 并填自检记录 |
| X6 | 文档同步 | 若改了消息协议/架构/接口，已同步更新《项目文档.md》、docs/API.md 与本文件 |

### 5. 验收门禁（正式验收，由用户确认）

| # | 验收项 | 说明 |
|---|--------|------|
| A1 | 功能完整性 | 按任务描述全部实现，无遗漏 |
| A2 | 指标达标 | 对照《项目文档》1.3 非功能指标：端到端延迟≤3s、断线 5s 内重连、内存≤200MB、车载噪声识别率≥90%（实车阶段实测） |
| A3 | 代码复核 | AI 生成的核心逻辑已人工复核，无幻觉 API/不存在的函数 |
| A4 | 无回归 | 已验收功能未被破坏（快速回归一遍） |
| A5 | 用户确认 | 用户确认验收通过，本文件状态改为 `🟢已验收` |

### 6. 状态流转约定

- `⬜未开始` → `🟡进行中` → `✅已完成` → `🟢已验收`
- `🔴阻塞`：遇到阻碍（如 API Key 未申请、云服务器未就绪），写明阻塞原因，等待用户决策
- `⏸️暂停`：主动暂停，写明原因和恢复条件
- 任务必须按顺序推进，前一项未 `🟢已验收` 不得开工下一项（除非用户明确允许并行；server 与 client 两条线内的任务也各自按序）

### 7. 上下文节约规则

- 每次开始新会话，AI 只需读本文件（第三部分进度快照）即可恢复全部进度，无需重读《项目文档.md》全文
- 复杂决策、踩过的坑、关键技术结论必须追加到"附录：开发日志"
- 砍掉的功能/放弃的方案记录在"已废弃"区，避免重复尝试

---

## 第二部分：整体项目进度规划

> 基于《项目文档》七、开发排期建议（4 周 MVP），前置 2 天立项骨架，共 5 阶段约 23 个工作日（含 2026-09-22 方案评审识别的 4 项技术调整工作量）。
> server 与 client 两条推进线：阶段一（server）先行，阶段二（client）依赖阶段一协议冻结；阶段三起联调。

### 阶段总览

| 阶段 | 天数 | 核心产出 | 状态 |
|------|------|----------|------|
| 零、立项与骨架 | Day 1-2 | 本规范 + 双端骨架 + API Key 就绪 | 🟡进行中 |
| 一、后端核心链路 | Day 3-7（Week 1） | WS 服务 + 智谱 LLM 流式 + 讯飞 ASR/TTS 流式管线 | ⬜未开始 |
| 二、车机端音频与通信 | Day 8-12（Week 2） | 音频采集 + VAD + WS 客户端 + 自动重连 + 播放 | ⬜未开始 |
| 三、UI 与联调 | Day 13-17（Week 3） | 对话 UI + 状态管理 + 端到端联调 + 延迟优化 | ⬜未开始 |
| 四、实车测试与交付 | Day 18-22（Week 4） | APK 打包 + 生产部署 + 实车测试 + 交付文档 | ⬜未开始 |

---

### 阶段零：立项与骨架（Day 1-2）

| 任务ID | 任务 | 产出 | 验收标准 | 状态 |
|--------|------|------|----------|------|
| T0.1 | 建立门禁式规范 | 本文件 | 本文件存在且四道门禁完整 | 🟢已验收(用户允许推进) |
| T0.2 | Git 仓库初始化 | 仓库 | git init + .gitignore（必须含 .env / node_modules / android build）+ 首次提交 | ✅已完成(2026-09-22, commit 18605bf) |
| T0.3 | server 骨架 | server/ | Node.js + TypeScript + Express + ws，按 2.3 目录结构建好，tsconfig strict，npm run dev 可启动空服务 | ✅已完成(2026-09-22, /health 与 / 端点 200 OK, commit b32b6b3) |
| T0.4 | client 骨架 | client/ | Expo init（RN + TS），按 2.3 目录结构建好 src 子目录，Expo Go 能加载空白页 | 🟢已验收(2026-09-22, 用户确认占位页显示, 真机 Expo Go SDK52 验证通过) |
| T0.5 | API Key 获取（用户操作） | .env | 智谱 Key + 讯飞 AppID/APISecret/APIKey 已申请；server/.env.example 写齐变量名 | 🔴阻塞(待用户) |
| T0.6 | 云服务器准备（用户操作，可后置） | 服务器 | Ubuntu 22.04 + Node 20 就绪（不阻塞阶段一本地开发） | ⏸️暂停(联调部署时再要) |

**阶段零验收记录**：
- T0.1 出口自检（2026-09-22）：本文件已按《项目文档.md》建立，四道门禁（入口 5 项/开发 12 项/出口 6 项/验收 5 项）完整。待用户验收。
- T0.1 验收通过（2026-09-22，用户指令"先不要考虑 API Key 和云服务器，先实现能做的"）：视同批准 T0.1 并允许阶段零后续任务开工；T0.5 跳过、T0.6 后置。
- T0.2 自检通过（2026-09-22，commit 18605bf）：`.gitignore` 已含 `.env`（D12 Key 安全关键）、`node_modules`、Android build、Expo/React Native 临时目录；首次提交 760 行。
- T0.3 自检通过（2026-09-22，commit b32b6b3）：server 端 tsconfig strict + ESM；`npm run typecheck` 0 错误；`npm run dev` 启动后 `/health` 与 `/` 端点 200 OK（Node v24.14.1，依赖 151 包 / 55.6MB）。
- T0.4 骨架完成（2026-09-22，🟡进行中待 Expo Go 交互验证，commit b32b6b3）：package.json + tsconfig + app.json + babel + App.tsx 就绪；`npm install` 874 包 (300MB)；`tsc --noEmit` 通过；**待用户执行 `cd client && npm start` + Expo Go 扫码验证空白页**（AI 会话无法替代）。
- T1.1 协议冻结（2026-09-22，提前至阶段零完成，commit b32b6b3）：`server/src/websocket/protocol.ts` 完整定义 ClientMessage/ServerMessage/ErrorCode/SessionConfig；相对《项目文档》3.2 扩展 5 项关键内容（详见开发日志）。阶段二 T2.3 WS 客户端必须严格按本协议实现。

---

### 阶段一：后端核心链路（Week 1，Day 3-7）

| 任务ID | 任务 | 产出 | 验收标准 | 状态 |
|--------|------|------|----------|------|
| T1.1 | WebSocket 协议定义 | src/websocket/protocol.ts | ClientMessage/ServerMessage 按《项目文档》3.2 定义为 interface；含心跳 ping/pong 与错误码约定 | ✅已完成(2026-09-22, 提前至阶段零完成, commit b32b6b3) |
| T1.2 | WebSocket 服务端 | server.ts + handler.ts | 连接建立/会话管理(sessionId)/消息分发/心跳/异常断开清理；非法消息返回 error 且不崩 | ✅已完成(2026-09-22, 自测 7/7 通过: 连接/error×2/pong/wsSessions/断开清理) |
| T1.3 | 智谱 LLM 流式客户端 | llm/zhipuClient.ts | OpenAI 兼容接口调用 glm-4.7-flash，chatStream 流式 yield；系统 Prompt 从配置读取；超时与错误降级 | ✅已完成(2026-09-22, src/services/llmService.ts；无Key错误路径自测通过；真实流式联调待 T0.5 Key) |
| T1.4 | 讯飞 ASR 对接 | asr/xunfeiAsr.ts | 流式听写：接收 PCM 分片推送，返回中间/最终识别文本（isFinal）；鉴权签名正确 | ⬜未开始 |
| T1.5 | 讯飞 TTS 对接 | tts/xunfeiTts.ts | 文本→音频，**按句合成**（句末标点 `，。！？` 触发）；返回格式 = **PCM 16kHz/16bit/单声道 + 44 字节 WAV 头 + base64**；AppID 鉴权正确；单句合成超时 ≤1.5s，失败时单句降级 Edge TTS（T1.6） | ⬜未开始 |
| T1.6 | Edge TTS 备用 | tts/edgeTts.ts | 免 Key 合成可用，作为讯飞 TTS 失败时降级；配置开关选择 TTS 后端；输出格式对齐 T1.5（WAV 头 + PCM base64） | ⬜未开始 |
| T1.7 | 流式管线编排 | handler.ts 集成 | ASR isFinal → LLM 流式 → **遇句末标点立即触发该句 TTS 合成（不等 LLM 流收完）** → 推送 llm_chunk + tts_audio → 客户端按句播放；全链路消息时序正确（asr_result → 多组 llm_chunk/tts_audio 对 → 最终结束标记）；分句策略可配（标点集、句长上限） | ⬜未开始 |
| T1.8 | 后端自测 | test/ws-client.mjs | 模拟客户端脚本跑通：发文本→收 llm_chunk 流；发预录 PCM→收 asr_result→llm→tts_audio | ⬜未开始 |

**里程碑**：Week 1 结束后端全链路可独立验证（无需车机端）。

---

### 阶段二：车机端音频与通信（Week 2，Day 8-12）

| 任务ID | 任务 | 产出 | 验收标准 | 状态 |
|--------|------|------|----------|------|
| T2.1 | 音频采集服务 | services/audioService.ts | **开发前用 context7/官方文档核实 expo-audio（Expo 官方 SDK，带 config plugin）与 react-native-audio-record 哪个支持 PCM 分块流回调**（D11），按核实结论选型；采集 16kHz/16bit/单声道 PCM，每 200ms 回调一个 chunk；权限申请与拒绝兜底；**调试走 dev build（`npx expo prebuild` + `assembleDebug`），Expo Go 不支持原生音频模块** | ⬜未开始 |
| T2.2 | VAD 语音活动检测 | services/vadService.ts | **自适应噪声门限**：前 1-2 秒采集环境噪声做基线（dB），运行时阈值 = 基线 + 6-10dB（可配），静音持续 800ms 触发说话结束；同时**启用讯飞服务端 vad_eos（800ms）作为最终断句依据**；阈值/时长/联动策略从配置读取 | ⬜未开始 |
| T2.3 | WebSocket 客户端 | services/websocketService.ts | 按 T1.1 协议收发（音频 base64/JSON）；消息序列化/反序列化类型安全 | ⬜未开始 |
| T2.4 | 自动重连 | hooks/useAutoReconnect.ts | 断开后 5 秒内自动重连（指数退避）；重连期间本地缓存未发送音频，恢复后续传 | ⬜未开始 |
| T2.5 | 音频播放 | services/audioService.ts 扩展 | **分句 WAV 播放队列**（TTS 按句到达，每句带 44 字节 WAV 头，独立播放，句间 gap ≤50ms）；**半双工**：speaking 状态暂停音频推送（采集不停），播报结束恢复；播放库选型前 context7/官方文档核实 PCM/WAV 支持（D11，候选 `expo-audio`/`react-native-sound`/`expo-av`，不再考虑 track-player）；音频焦点处理（系统通知/导航播报时降音量或暂停） | ⬜未开始 |
| T2.6 | 语音代理主逻辑 | hooks/useVoiceAgent.ts | 采集→VAD→发送→asr/llm/tts 接收→播放 完整状态机（idle/listening/recognizing/thinking/speaking）；多轮连续对话无需重启；与 T2.5 半双工策略联动 | ⬜未开始 |

**里程碑**：Week 2 结束手机/模拟器上完成一轮完整语音问答（丑但能通）。

---

### 阶段三：UI 与联调（Week 3，Day 13-17）

| 任务ID | 任务 | 产出 | 验收标准 | 状态 |
|--------|------|------|----------|------|
| T3.1 | 对话界面 | components/ChatBubble.tsx + VoiceWave.tsx | 对话气泡展示识别文本与回复；录音/播报时波形动画 | ⬜未开始 |
| T3.2 | 对话状态管理 | store/conversationStore.ts | 多轮对话历史维护并作为 LLM 上下文传入（截断策略防超上下文） | ⬜未开始 |
| T3.3 | 设置面板 | components/SettingsPanel.tsx | 可配置服务器地址、TTS 后端/音色、VAD 灵敏度；本地持久化 | ⬜未开始 |
| T3.4 | 端到端联调 | 联调记录 | client+server 局域网真机联调，完整多轮对话跑通，记录问题清单 | ⬜未开始 |
| T3.5 | 延迟优化 | 优化记录 | 首句 TTS 提前（不等 LLM 收完）、分句粒度调优，端到端（说话结束→开始播报）≤3s | ⬜未开始 |
| T3.6 | 断线重连验证 | 测试记录 | 弱网/飞行切换模拟，断开后 5 秒内自动重连并恢复会话 | ⬜未开始 |

---

### 阶段四：实车测试与交付（Week 4，Day 18-22）

| 任务ID | 任务 | 产出 | 验收标准 | 状态 |
|--------|------|------|----------|------|
| T4.1 | Android 权限与打包 | APK | RECORD_AUDIO/INTERNET/MODIFY_AUDIO_SETTINGS 权限入 Manifest；`npx expo prebuild --platform android` 生成 android 工程后 `gradlew assembleRelease` 出 APK（**注意：项目文档 4.2 “方式一：Expo Go 快速测试”不适用于音频模块，调试走 dev build APK**；按 T2.1 选型可能需在 android 工程加额外配置） | ⬜未开始 |
| T4.2 | 后端生产部署 | 部署脚本 | PM2 守护 + Nginx 443 反代 wss://，按《项目文档》4.1 步骤；客户端连生产地址跑通 | ⬜未开始 |
| T4.3 | 实车测试 | 测试报告 | 车机安装实测：噪声环境识别率≥90%、内存≤200MB、端到端延迟≤3s，记录问题清单 | ⬜未开始 |
| T4.4 | Bug 修复与稳定性 | 修复记录 | 实车反馈 P0/P1 全部修复（重连、音频焦点、内存） | ⬜未开始 |
| T4.5 | 交付文档 | docs/API.md + DEPLOY.md | 协议文档与部署指南齐全，他人可按文档部署 | ⬜未开始 |

**里程碑**：MVP 交付，可日常使用。

---

### V2 待开发（MVP 上线后迭代）

> 来源：《项目文档》八、后续扩展方向 + 风险应对中的增强项。

| 任务ID | 任务 | 来源 | 说明 |
|--------|------|------|------|
| V2.1 | 离线降级 | 扩展方向 1 | 弱网切换本地关键词识别（"打开空调"、"导航回家"） |
| V2.2 | 车辆控制 | 扩展方向 2 | 对接 CAN 总线/车企开放 API 语音控车 |
| V2.3 | 多模态交互 | 扩展方向 3 | 语音+触控混合交互 |
| V2.4 | 个性化记忆 | 扩展方向 4 | 记录常去地点/音乐喜好的智能推荐 |
| V2.5 | 多 Key 轮询降级 | 风险应对 | 免费 API 限流时多 Key 轮询 + 预设回复降级 |

---

## 第三部分：当前进度快照

> 每次会话结束更新此区，AI 新会话只读本区即可快速恢复上下文。

**当前阶段**：阶段一 - 后端核心链路（阶段零已全部完成验收）
**当前任务**：T1.2/T1.3 已完成；下一项 T1.4 讯飞 ASR 流式听写
**已完成并验收**：T0.1, T0.2, T0.3, T0.4, T1.1
**已完成待验收**：无
**阻塞项**：T0.5 API Key 获取（智谱+讯飞，需用户注册申请，阻塞 T1.8 真实链路自测；阶段一代码可先写用 .env.example 占位）
**本地仓库**：已初始化（main 分支）
**远程仓库**：https://github.com/Yoozzzzzz/voice-car-assistant.git（origin，2026-09-22 绑定并首推 main）
**下一步**：T1.2 WS 服务端 → T1.3/T1.4/T1.5/T1.6 外部对接 → T1.7 流式编排 → T1.8 自测脚本

**关键技术调整（2026-09-22 方案评审落地，已写入对应任务验收标准）**：
- T1.5/T1.7：按句切分 TTS（WAV 头+PCM base64），LLM 流遇句末标点立即合成不等收完
- T2.1：候选库 expo-audio / react-native-audio-record，开发前 context7 核实 PCM 流回调；调试走 dev build
- T2.2：自适应噪声门限 + 讯飞服务端 vad_eos 兜底
- T2.5：分句 WAV 播放队列 + 半双工；放弃 track-player
- T4.1：APK 打包注明 Expo Go 不适用

**关键文件路径**：
- 项目根：e:\aliu\project\mine\voice-car-assistant
- 需求文档：项目文档.md（架构 2.3 目录结构、3.x 核心模块设计、4.x 部署方案）
- 计划产出：client/（RN+Expo）、server/（Node.js+TS）、docs/（API.md、DEPLOY.md）

**关键架构约定（来自《项目文档》，开发时遵守）**：
- 通信：WebSocket wss://，全双工；消息 JSON 格式，音频 base64
- 音频：采集 16kHz/16bit/单声道 PCM，200ms chunk；VAD 静音 800ms 断句
- LLM：智谱 glm-4.7-flash，OpenAI 兼容接口，流式，回复≤50字系统 Prompt
- 流式管线：LLM 流式文本按句切分→边收边 TTS（延迟达标关键）

---

## 第四部分：已废弃方案

> 记录被砍掉的方案，避免重复尝试。

（暂无）

---

## 第五部分：附录 - 开发日志

> 记录关键技术结论、踩坑、决策理由。按日期追加。

### 2026-09-22
- 项目启动：依据《项目文档.md》建立本门禁式规范，将 4 周排期细化为 5 阶段 22 任务（阶段零骨架 / 后端链路 / 客户端音频 / UI 联调 / 实车交付）
- 关键决策：阶段一（后端）先行并冻结 WebSocket 协议（T1.1），阶段二客户端依赖该协议开发；T1.8 提供模拟客户端脚本，后端可在无车机端时独立验证
- 关键决策：新增 D12 Key 安全门禁（API Key 仅存服务端 .env），对应《项目文档》风险表"API Key 泄露"项
- 阻塞记录：T0.5 API Key（智谱/讯飞）待用户申请；不阻塞阶段零/一编码，阻塞 T1.8 真实链路自测
- **技术方案评审（用户发起）**：识别 4 个高风险点并提出调整方案——①Expo Go 不支持原生音频模块，音频调试改走 dev build；②track-player 不支持 raw PCM 流，播放改为"服务端按句切分+每句返回 WAV+客户端分句播放队列"（延迟达标关键路径）；③固定阈值 VAD 车载噪声下不可靠，改自适应噪声门限+讯飞服务端 VAD 兜底；④RN 无 AEC，采用半双工（speaking 状态暂停采集推送）
- **D11 合规说明**：本次评审初稿未查 context7（会话中不可用），后经 web 搜索核实——①②③④全部成立；且发现 expo-audio（Expo 官方，带 config plugin）可能优于 react-native-audio-record，其是否支持 PCM 分块流回调待 T2.1 开发前用官方文档/context7 核实后选型
- 待核实项（对应任务开发前 D11 执行）：expo-audio PCM 流回调（T2.1）；智谱 glm-4.7-flash QPS 限制（T1.3）；讯飞 TTS WebAPI 鉴权细节（T1.5）；讯飞听写 WebAPI 单连接 60s 限制+vad_eos 参数已核实（0-10000ms，默认 2000ms，本项目设 800ms）
- **规范升级（D11 强制化）**：用户要求强化 context7 使用要求。原 D11 仅"context7/官方文档"并列提及，不强制；现升级为：①首选 context7，context7 不可用时 fallback 到 web 搜索/官方文档，**核实来源与结论必须写入第五部分开发日志**；②E2 增加联动项（涉及新库/新 API 时须先核实选型与签名）；③覆盖范围扩展到"库选型/版本兼容性/API 签名/已知坑"，防止幻觉库名/函数名/版本。严禁凭训练记忆编造
- **规范落地（4 项技术调整写入任务验收）**：基于方案评审结论更新 T1.5/T1.7（按句 TTS+WAV 头）、T2.1（候选库核实+dev build 调试）、T2.2（自适应 VAD+vad_eos 兜底）、T2.5（分句 WAV 队列+半双工）、T4.1（Expo Go 不可用备注）；总工期 22 天 → 23 天

### 2026-09-22（续）— 工程计划排序与"先做什么/再做什么"
- 用户发起会话："按门禁规范进行工程计划排序，先做什么？再做什么？然后维护进度文档"
- 排序原则：§3 D9 不破坏旧 + §6 状态流转（串行为默认、并行需明确）+ D11 库/API 核实先行
- **关键路径串行**（不可调整）：`T0.2 Git 初始化` → `T1.1 WebSocket 协议冻结` → `T1.2 WS 服务` → `T1.7 流式编排` → `T1.8 后端自测` → 阶段二 T2.1-T2.6 → 阶段三 T3.1-T3.6 → 阶段四 T4.1-T4.5
- **可并行优化**（基于双端/模块物理独立，须用户明确允许）：
  1. `T0.3 server 骨架` ↔ `T0.4 client 骨架`：目录独立（server/src vs client/src）
  2. `T1.3 智谱 LLM` ↔ `T1.4 讯飞 ASR` ↔ `T1.5 讯飞 TTS` ↔ `T1.6 Edge TTS`：四个外部对接相互独立，依赖 T1.1 协议 + T1.2 骨架即可并行
  3. `T2.1 音频采集` ↔ `T2.3 WS 客户端` ↔ `T2.4 自动重连`：模块独立（依赖 T1.1 协议已冻结）
  4. `T3.1 对话界面` ↔ `T3.3 设置面板`：UI 组件独立
- **D11 必查节点**（开发前核实，结论写本日志）：T1.3 智谱 glm-4.7-flash QPS；T1.4 讯飞听写 WebAPI 60s 单连接限制；T1.5 讯飞 TTS WebAPI 鉴权签名最新签名；T2.1 expo-audio vs react-native-audio-record 的 PCM 分块流回调支持
- **阻塞项维持**：T0.5 API Key（不阻塞编码，.env.example 占位，仅阻塞 T1.8 真实链路自测）；T0.6 云服务器（暂停，阶段三联调部署时启动）
- **当前应执行**：T0.2 Git 仓库初始化（注意：T0.1 仍为"已完成待验收"状态，严格按 §6 须用户确认 T0.1 🟢 后才能开工 T0.2；建议用户在本次会话一并验收 T0.1 以解锁 T0.2）

### 2026-09-22（再续）— 阶段零骨架实现完成 + 协议提前冻结
- 用户指令："先不要考虑 API Key 和云服务器，先实现能做的"。按 §6 用户明确允许推进，标注 T0.1 为 🟢已验收（用户允许推进），开工 T0.2→T0.3→T0.4→T1.1
- **T0.2 Git 初始化**（commit `18605bf`）：`.gitignore` 含 `.env`（D12 Key 安全关键）、`node_modules`、Android build、Expo/React Native 临时目录
- **T0.3 server 骨架**（commit `b32b6b3`）：
  - 选型 Node.js v24.14.1 + Express 4.21 + openai 4.71 + ws 8.18 + pino 9.5（npm install 151 包，55.6MB）
  - tsconfig strict + ES2022 + ESM；`src/index.ts` 含 health check + 优雅关闭 + 未处理异常兜底
  - `src/config.ts` 统一读 .env，禁用硬编码 Key；`validateConfig()` 启动时告警缺失项
  - `src/utils/logger.ts`：pino dev 彩色/prod JSON
  - `.env.example` 模板含所有 Key 变量名 + 注释 + 智谱/讯飞获取指南
  - 自检：`npm run typecheck` 0 错误；`npm run dev` 启动后 `/health` 与 `/` 端点 200 OK
- **T0.4 client 骨架**（commit `b32b6b3`，🟡进行中待 Expo Go 验证）：
  - **D11 库核实**：web 搜索 Expo 官方 SDK 页，确认最新为 SDK 57(2026-06-30) 但 RN 对应版本不确定；为稳妥用 **SDK 52(2024-11-12) → RN 0.76.5 → React 18.3.1**（已知稳定组合，文档充分）
  - `src/App.tsx` 占位界面（深色背景 + 阶段零标语）；`src/{components,services,hooks,store}/` 子目录 + README 占位（符合 2.3 规范）
  - `babel-preset-expo` + tsconfig 继承 `expo/tsconfig.base` + 路径别名 `@/*`
  - `app.json` 含 Android `RECORD_AUDIO`/`INTERNET`/`MODIFY_AUDIO_SETTINGS` 权限预声明
  - 自检：`npm run typecheck` 0 错误；`npm install` 874 包 (300MB)；**Expo Go 加载空白页验证需用户在物理设备扫码 `npx expo start`，AI 会话无法替代**
- **T1.1 WS 协议冻结**（commit `b32b6b3`，**提前至阶段零完成**）：
  - `server/src/websocket/protocol.ts` 完整定义：常量 + ErrorCode + ClientMessage(4 子类) + ServerMessage(6 子类) + SessionConfig + PROTOCOL_VERSION
  - **相对《项目文档》3.2 的 5 点扩展**（关键路径延迟达标必须）：① 客户端 `audio.isLast` 标记本轮结束；② 客户端 `ping` 心跳；③ 服务端 `llm_chunk.sentenceId` 配对 TTS；④ `tts_audio` 明确 WAV(44 字节头) + PCM 16kHz/16bit/单声道 base64；⑤ `ErrorCode` 枚举
  - 阶段二 T2.3 WS 客户端**必须严格按本协议实现**，变更需同步更新《项目文档》/`docs/API.md`/本文件
- **门禁遵守情况**：入口 5 项逐项核对 ✓；D1(目录)/D3(配置驱动)/D4(单一职责 index.ts 100 行内)/D5(中文注释)/D6(禁用 any)/D8(错误边界)/D10(提交前缀 `feat:`/`chore:`)/D11(库核实 web 搜索)/D12(Key 安全) 全 ✓；D7(不写 mock)骨架阶段不涉及；D9(不破坏旧)新建项目不涉及；D2(命名) PascalCase/camelCase/UPPER_SNAKE ✓
- **未做事项**：T0.5 API Key 申请（用户操作，待补 server/.env）；T0.6 云服务器（暂停，阶段三联调时启动）
- **下一步建议**：① 用户在设备上执行 `cd client && npm start` + Expo Go 扫描验证 T0.4；② 用户申请 T0.5 API Key 并填入 `server/.env`；③ 验收通过后开工 T1.2 WS 服务（依赖本协议 T1.1）

### 2026-09-22（三续）— 远程仓库绑定
- 用户提供远程地址，绑定 `origin` = https://github.com/Yoozzzzzz/voice-car-assistant.git，首推 main（3 个提交：`18605bf` / `b32b6b3` / `a68620b`）成功
- 用户确立提交纪律：**每完成一个小节点即 commit + push**（已写入 D10 门禁）

### 2026-09-22（四续）— 修复 expo start 报错 + 环境限制记录
- 用户报错：`expo start` → `The required package 'expo-asset' cannot be found`。**根因**：T0.4 手写 package.json 缺 Expo 运行时基础包（`create-expo-app` 模板默认携带，手搭骨架易漏）
- **修复**（commit `8ed177f`）：`npx expo install expo-asset expo-font expo-constants expo-file-system`（自动匹配 SDK 52 版本，并在 app.json 注入 config plugins）；验证：Metro 于 8082 端口正常启动（`Starting Metro Bundler / Waiting on http://localhost:8082`）✅
- **环境限制（重要踩坑）**：本机 safe-delete 安全组件拦截 npm 对 node_modules 的删除操作，导致 `react-native 0.76.5 → 0.76.9` 升级失败（`[safe-delete] 操作失败: trash`）。处理：回退 package.json 声明到 0.76.5，与 lockfile/node_modules 保持一致；expo 警告"建议 0.76.9"**不阻塞开发**，后续如需升级须在能正常删除 node_modules 的环境执行（或手动删 node_modules 后重装）
- 8081 端口被用户前次启动残留进程占用；验证用 8082 避开。用户如遇同样提示，结束旧终端进程或改用 `npm start -- --port 8082`
- tsconfig 被 expo CLI 重写时误删 `.expo/types` / `expo-env.d.ts` include，已手工恢复
- **Expo Go 版本不匹配**（用户报错）：手机应用商店装的 Expo Go 为 SDK 57，项目为 SDK 52 → `Project is incompatible with this version of Expo Go`。**决策**：手机改装 SDK 52 版 Expo Go（官方下载页 `expo.dev/go?sdkVersion=52&platform=android`）；暂不升级项目至 SDK 57（受本机 safe-delete 拦截 node_modules 删除所限，大版本升级依赖重装必失败）。**待办**：在可正常删除 node_modules 的环境执行 SDK 57 升级（手动删 node_modules 后 npx expo install expo@^57 + 依赖刷新），阶段二 dev build 前完成即可
- **"main" has not been registered**（用户报错，commit `3058cc3`）：根因 = package.json 的 `main` 直接指向 `src/App.tsx`，但 App.tsx 只有 `export default`，未调用 `registerRootComponent`（Expo 默认模板 main 指向 `expo/AppEntry.js` 代为注册，手搭骨架直接指 App.tsx 时必须显式注册）。**修复**：`import { registerRootComponent } from 'expo'` + 文件末尾 `registerRootComponent(App)`。typecheck 通过。**手搭 Expo 骨架两大坑（均已踩）**：①缺运行时基础包（expo-asset 等）；②缺根组件注册。后续新项目建议直接 `create-expo-app` 生成再裁剪

### 2026-09-22（五续）— 阶段零验收收官 + T1.2 WebSocket 服务端完成
- 用户确认 T0.4 验收通过（真机 Expo Go 显示占位页）→ **阶段零全部完成**（T0.1/T0.2/T0.3/T0.4/T1.1 均 🟢；T0.5 跳过待 Key、T0.6 暂停）
- **T1.2 WebSocket 服务端**（三模块拆分，D4 单一职责）：
  - `src/websocket/session.ts`：SessionManager（sessionId 生成 uuid v4/首条消息绑定/同 sessionId 重连踢旧连接/Map 单机存储，阶段三可换 Redis）
  - `src/websocket/handler.ts`：JSON 解析→类型守卫校验（D6 无 any 断言）→按 type 路由；非法消息回 error(INVALID_MESSAGE) 不崩；ping→pong；audio/text/control 记录日志等 T1.4/T1.7 接入（D7 不写 mock 不伪造回复）
  - `src/websocket/wsServer.ts`：**双层心跳**——协议层 ws ping/pong 帧（30s 间隔，穿透 NAT）+ 应用层 ping 消息（60s 超时断开）；close/error 全量清理；优雅关闭 shutdownWebSocket
  - `index.ts`：挂载 /ws、/health 增加 wsSessions、stage 更新 stage1-ws-server
- **T1.2 自测 7/7 通过**（临时脚本已删，正式版等 T1.8）：①连接建立 ②非法 JSON→error ③非法结构→error ④服务未崩 ⑤ping→pong ⑥wsSessions=1 ⑦断开清理归零
- 注意：8080 上跑着用户的 tsx watch dev 实例，热重载自动加载了 T1.2 新代码（自测即连该实例）；后续并行实例注意端口冲突
- **下一步**：T1.3 智谱 LLM 流式客户端（D11 先核实 glm-4.7-flash QPS 与 OpenAI 兼容接口签名）

### 2026-09-22（六续）— T1.2 推送完成 + T1.3 智谱 LLM 流式客户端完成
- 网络恢复，T1.2 提交 `d5e5f3c` 已推送远程；`client/tsconfig.json` 被 expo CLI 再次重写已恢复（该 CLI 每次启动都可能删 `.expo/types`/`expo-env.d.ts` include，遇 diff 注意恢复）
- **T1.3 D11 核实（web 搜索）**：GLM-4.7-Flash（2026-01-20 发布）永久免费、OpenAI 兼容、`https://open.bigmodel.cn/api/paas/v4`、模型名 `glm-4.7-flash`；**免费 API 限 1 并发**（关键约束）；混合思考模型流式 delta 含 `reasoning_content` 需过滤
- **T1.3 实现**（`src/services/llmService.ts`，回调式 onDelta 直接对接 T1.7 按句切分）：
  - openai SDK 指向 bigmodel baseURL；60s 超时 + maxRetries 1
  - `SYSTEM_PROMPT`（140 字）：口语化、≤3 句、单句 ≤25 字、规范句末标点（为 T1.7 按句 TTS 切分服务）、禁 emoji/markdown/代码块
  - **全局并发互斥**（promise 链串行队列）适配免费 1 并发限制
  - `reasoning_content` 过滤（思考过程不进正文不下发 TTS）
  - `LlmError` 统一错误类型（调用方映射 error(LLM_FAILED)）；AbortSignal 中断不算错误（T1.7 interrupt 用）
  - max_tokens 512 + temperature 0.7 双保险控回复长度
- **T1.3 自测**（Key 未配，按 D7 不 mock，仅测可测路径）：无 Key → LlmError('ZHIPU_API_KEY 未配置') ✅；系统提示词导出 ✅。**真实流式联调挂起至 T0.5 Key 到位**（届时 T1.8 一并补）
- **下一步**：T1.4 讯飞 ASR 流式听写（D11 先核实 WebAPI 签名算法）

---

## 使用说明（给 AI）

1. **新会话开局**：读本文件"第三部分：当前进度快照"即可恢复上下文，无需重读《项目文档.md》
2. **开工前**：核对"入口门禁"5 项是否通过
3. **开发中**：遵守"开发过程门禁"12 项约束（注意 **D7 不写 mock、D11 必须用 context7 核实库/API（不可用时 fallback web 搜索并记日志）、D12 Key 安全**）
4. **完成后**：自检"出口门禁"6 项，更新本文件任务状态为 `✅已完成`
5. **验收时**：对照"验收门禁"5 项（含 1.3 非功能指标），用户确认后改为 `🟢已验收`
6. **遇到坑**：追加到"第五部分：开发日志"
7. **砍方案**：记录到"第四部分：已废弃方案"
