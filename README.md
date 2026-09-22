# voice-car-assistant 车机语音问答助手

车机端语音问答系统：React Native (Expo) 车机 App ←WebSocket→ Node.js 后端 ←→ 智谱 GLM（LLM）+ 讯飞（ASR/TTS）。

- 规范与进度：[`AI_DEV_SPEC.md`](./AI_DEV_SPEC.md)（门禁式开发规范 + 当前进度快照）
- 需求与架构：[`项目文档.md`](./项目文档.md)

## 技术栈

| 端 | 技术 |
|----|------|
| server | Node.js ≥20 + TypeScript (strict) + Express + ws + pino |
| client | Expo SDK 52 + React Native 0.76 + React 18.3 + TypeScript |
| 外部服务 | 智谱 `glm-4.7-flash`（免费）/ 讯飞语音听写 ASR / 讯飞 TTS（备用 Edge TTS） |

## 环境要求

- **Node.js ≥ 20**（推荐 LTS）
- 手机安装 **Expo Go**（App Store / Google Play / 国内应用市场）
- 可选：Android Studio（生成 dev build 调试原生音频模块时用，见下文"打包"）

---

## 一、启动（开发）

### 1. 启动后端 server

```powershell
cd server
npm install                 # 首次
copy .env.example .env      # 首次：复制配置模板（Windows）
# macOS/Linux 用: cp .env.example .env
# 然后编辑 .env 填入 API Key（见下文"配置"）

npm run dev                 # 开发模式（tsx watch，改代码自动重启）
```

验证：浏览器访问 `http://localhost:8080/health`，返回 200 即启动成功。

### 2. 启动车机端 client

新开一个终端：

```powershell
cd client
npm install                 # 首次（约 300MB，耐心等待）

npm start                   # 启动 Expo 开发服务器（Metro）
```

然后任选其一在手机上打开：

| 方式 | 操作 |
|------|------|
| **Expo Go 扫码**（推荐调试 UI） | 手机与电脑同一局域网，用 Expo Go 扫终端里的二维码 |
| Android 设备已连 adb | `npm run android` |
| iOS 模拟器（macOS） | `npm run ios` |
| Web 浏览器（仅 UI 预览） | `npm run web` |

> ⚠️ **注意**：Expo Go 只能调试纯 JS UI。**涉及原生音频模块（录音/播放）的调试必须走 dev build**（见下文打包），Expo Go 不支持。当前阶段（骨架）用 Expo Go 验证空白页即可。

### 3. 类型检查（提交前）

```powershell
cd server  ; npm run typecheck
cd client  ; npm run typecheck
```

---

## 二、配置（server/.env）

`.env` 已被 `.gitignore` 排除，**永远不入库**。模板见 `server/.env.example`，关键项：

```ini
PORT=8080
ZHIPU_API_KEY=           # 智谱：https://open.bigmodel.cn/ → API Keys（glm-4.7-flash 免费）
XUNFEI_APP_ID=           # 讯飞：https://www.xfyun.cn/ → 创建应用 → 开通"语音听写"+"在线语音合成"
XUNFEI_ASR_API_KEY=
XUNFEI_ASR_API_SECRET=
XUNFEI_TTS_API_KEY=
XUNFEI_TTS_API_SECRET=
TTS_BACKEND=xunfei       # xunfei | edge（Edge TTS 免 Key 备用）
```

骨架阶段未填 Key 只会打警告，不阻塞启动；真实链路联调前必须补齐。

---

## 三、打包

### 1. 后端打包（部署到服务器）

```powershell
cd server
npm run build     # tsc 编译到 dist/
npm start         # node dist/index.js（生产运行，读 .env）
```

部署：将 `dist/` + `package.json` + `package-lock.json` + `.env` 上传服务器 → `npm ci --omit=dev` → 用 pm2/systemd 托管 `node dist/index.js`。

### 2. 客户端打包（Android APK）

> 音频采集/播放依赖原生模块，**正式调试与交付必须打 dev build / release 包**，Expo Go 不可用。

**方式 A：EAS 云打包（无需本地 Android 环境）**

```powershell
cd client
npx eas login                      # 注册 expo.dev 账号（免费）
npx eas build:configure            # 首次配置
npx eas build -p android --profile preview    # 产出可安装 APK（preview 含调试）
npx eas build -p android           # release 包
```

**方式 B：本地打包（需 Android Studio + JDK）**

```powershell
cd client
npm install -g eas-cli
npx expo prebuild -p android                # 生成 android/ 原生工程
cd android
.\gradlew.bat assembleDebug                 # 调试包 android/app/build/outputs/apk/debug/
.\gradlew.bat assembleRelease               # 发布包（需配置签名）
```

### 3. iOS 打包（macOS + Apple 开发者账号，按需）

```powershell
cd client
npx expo prebuild -p ios
# Xcode 打开 ios/*.xcworkspace，配置签名后 Archive
```

---

## 四、目录结构

```
voice-car-assistant/
├── AI_DEV_SPEC.md          # 开发规范 + 进度（新会话 AI 必读）
├── 项目文档.md              # 需求 / 架构 / 协议设计
├── server/                 # Node.js 后端
│   ├── src/
│   │   ├── index.ts        # 入口（health check + 优雅关闭）
│   │   ├── config.ts       # 环境变量统一读取
│   │   ├── websocket/      # WS 协议定义（protocol.ts）与服务
│   │   ├── llm/ asr/ tts/  # 外部服务对接（阶段一开发）
│   │   ├── handlers/       # 流式管线编排（阶段一开发）
│   │   └── utils/          # logger 等工具
│   └── .env.example        # 配置模板
└── client/                 # Expo 车机端
    ├── app.json            # Expo 配置（含 Android 录音/网络权限）
    ├── babel.config.js
    └── src/
        ├── App.tsx         # 入口
        ├── components/     # UI 组件（阶段三开发）
        ├── services/       # 音频采集/播放/WS 客户端（阶段二开发）
        ├── hooks/          # useAutoReconnect 等
        └── store/          # 状态管理
```

## 五、常见问题

| 问题 | 处理 |
|------|------|
| Expo Go 扫码连不上 | 手机与电脑须同一局域网；被防火墙拦截时按终端提示操作 |
| 启动报 ZHIPU/XUNFEI Key 警告 | 正常（骨架阶段），填好 `server/.env` 后消失 |
| 录音功能在 Expo Go 里不可用 | 预期内：原生模块需 dev build（见"客户端打包"） |
| `npm install` client 很慢 | 可换国内镜像：`npm config set registry https://registry.npmmirror.com` |
