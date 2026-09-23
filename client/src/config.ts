/**
 * 客户端配置（D3 配置驱动）
 *
 * SERVER_PORT / WS_PATH：后端 WebSocket 端口与路径
 *   - 本机模拟器调试：ws://10.0.2.2:8080/ws（Android 模拟器访问宿主机）
 *   - 真机 Expo Go 调试：ws://<电脑局域网 IP>:8080/ws（getDevServerWsUrl 自动推导）
 *   - 生产环境：wss://your-domain.com/ws（手动在界面填写）
 *
 * 界面上可临时修改（会话内生效），此处为默认值。
 */
import Constants from 'expo-constants';

/** 后端服务端口 */
export const SERVER_PORT = 8080;

/** WebSocket 路径（与 server/src/websocket/protocol.ts WS_PATH 一致） */
export const WS_PATH = '/ws';

/** 应用层心跳间隔（ms），须小于服务端 60s 心跳超时 */
export const HEARTBEAT_INTERVAL_MS = 25_000;

/**
 * 推导默认 WS 地址
 *
 * Expo Go 通过 `expo start`（LAN 模式）加载时，Constants.expoConfig.hostUri
 * 为开发电脑地址（格式 "192.168.x.x:8081"，端口是 Metro 的，需剥掉换成后端端口）。
 * 拿不到（生产/隧道模式/本机 web 调试）时退回 localhost。
 */
export function getDevServerWsUrl(): string {
  const hostUri = Constants.expoConfig?.hostUri;
  if (typeof hostUri === 'string' && hostUri.length > 0) {
    const host = hostUri.split(':')[0];
    // 剥掉 Metro(8081) 端口，只保留 IP/主机名
    if (host.length > 0) {
      return `ws://${host}:${SERVER_PORT}${WS_PATH}`;
    }
  }
  return `ws://localhost:${SERVER_PORT}${WS_PATH}`;
}
