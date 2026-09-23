/**
 * 客户端配置（D3 配置驱动）
 *
 * SERVER_WS_URL：后端 WebSocket 地址
 *   - 本机模拟器调试：ws://10.0.2.2:8080/ws（Android 模拟器访问宿主机）
 *   - 真机 Expo Go 调试：ws://<电脑局域网 IP>:8080/ws（如 ws://192.168.1.100:8080/ws）
 *   - 生产环境：wss://your-domain.com/ws
 *
 * 界面上可临时修改（会话内生效），此处为默认值。
 */
export const SERVER_WS_URL = 'ws://localhost:8080/ws';

/** 应用层心跳间隔（ms），须小于服务端 60s 心跳超时 */
export const HEARTBEAT_INTERVAL_MS = 25_000;
