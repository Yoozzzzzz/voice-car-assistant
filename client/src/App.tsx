import { StatusBar } from 'expo-status-bar';
import { StyleSheet, Text, View } from 'react-native';

/**
 * 车机端根入口（阶段零骨架）
 *
 * 阶段一将等待 T1.1 WebSocket 协议冻结后接入通信
 * 阶段二将接入：
 *   - T2.1 音频采集（src/services/audioService.ts）
 *   - T2.2 VAD 语音活动检测（src/services/vadService.ts）
 *   - T2.3 WebSocket 客户端（src/services/websocketService.ts）
 *   - T2.4 自动重连（src/hooks/useAutoReconnect.ts）
 *   - T2.5 音频播放（src/services/audioService.ts 扩展）
 *   - T2.6 语音代理主逻辑（src/hooks/useVoiceAgent.ts）
 * 阶段三将接入：
 *   - T3.1 对话气泡（src/components/ChatBubble.tsx）
 *   - T3.3 设置面板（src/components/SettingsPanel.tsx）
 */
export default function App() {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>车机语音助手</Text>
      <Text style={styles.subtitle}>阶段零 · 骨架就绪</Text>
      <Text style={styles.status}>Stage: zero-skeleton → stage 1 pending</Text>
      <StatusBar style="auto" />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#1a1a1a',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  title: {
    fontSize: 36,
    fontWeight: 'bold',
    color: '#ffffff',
    marginBottom: 12,
  },
  subtitle: {
    fontSize: 18,
    color: '#cccccc',
    marginBottom: 24,
  },
  status: {
    fontSize: 12,
    color: '#888888',
  },
});