import { StatusBar } from 'expo-status-bar';
import { registerRootComponent } from 'expo';
import {
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useCallback, useEffect, useRef, useState } from 'react';
import { getDevServerWsUrl } from './config';import { WebSocketService, type WsStatus } from './services/websocketService';
import type { ServerMessage } from './services/protocol';

/** 单条对话消息 */
interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  /** assistant 流式接收中 */
  streaming?: boolean;
}

/** 消息自增 ID */
let msgSeq = 0;
function nextId(): string {
  msgSeq += 1;
  return `m-${msgSeq}`;
}

/** 连接状态的展示文案与颜色 */
function statusInfo(status: WsStatus): { label: string; color: string } {
  switch (status) {
    case 'connected':
      return { label: '已连接', color: '#4caf50' };
    case 'connecting':
      return { label: '连接中…', color: '#ffb300' };
    default:
      return { label: '未连接', color: '#f44336' };
  }
}

/**
 * 车机端根入口
 *
 * 当前能力：文字输入框 → WS text 消息 → 服务端 LLM 流式回复（llm_chunk 增量渲染）
 * 后续接入：T2.1 音频采集 / T2.6 语音代理 / T3.1 波形动画 / T3.3 设置面板
 */
export default function App() {
  const [serverUrl, setServerUrl] = useState(() => getDevServerWsUrl());
  const [status, setStatus] = useState<WsStatus>('disconnected');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  /** LLM 429 限流重试进度提示（如"模型限流，正在重试（1/3）…"），回复开始/结束/失败时清除 */
  const [llmStatus, setLlmStatus] = useState<string | null>(null);

  const wsRef = useRef<WebSocketService | null>(null);
  const listRef = useRef<FlatList<ChatMessage>>(null);

  /** 处理服务端消息：llm_chunk 增量拼到最后一条 assistant 消息；llm_end/error 收尾 */
  const handleServerMessage = useCallback((msg: ServerMessage) => {
    if (msg.type === 'llm_retry') {
      setLlmStatus(`模型限流，正在重试（${msg.retry}/${msg.maxRetries}）…`);
    } else if (msg.type === 'llm_chunk') {
      setLlmStatus(null);
      setMessages((prev) => {
        const last = prev[prev.length - 1];
        // 最后一条是流式中的 assistant 消息 → 追加；否则新建
        if (last && last.role === 'assistant' && last.streaming) {
          return [...prev.slice(0, -1), { ...last, text: last.text + msg.text }];
        }
        return [...prev, { id: nextId(), role: 'assistant', text: msg.text, streaming: true }];
      });
    } else if (msg.type === 'llm_end') {
      setLlmStatus(null);
      setMessages((prev) => {
        const last = prev[prev.length - 1];
        if (last && last.role === 'assistant' && last.streaming) {
          // 以服务端 fullText 为准（防增量丢字）
          return [...prev.slice(0, -1), { ...last, text: msg.fullText, streaming: false }];
        }
        return [...prev, { id: nextId(), role: 'assistant', text: msg.fullText }];
      });
      setSending(false);
    } else if (msg.type === 'error') {
      setLlmStatus(null);
      setMessages((prev) => [
        ...prev,
        { id: nextId(), role: 'assistant', text: `[错误 ${msg.code}] ${msg.message}`, streaming: false },
      ]);
      setSending(false);
    }
    // pong：心跳响应，无需处理
  }, []);

  // 创建 WS 服务并订阅（组件挂载一次）
  useEffect(() => {
    const service = new WebSocketService();
    wsRef.current = service;
    service.onStatusChange(setStatus);
    service.onMessage(handleServerMessage);
    return () => {
      service.disconnect();
      wsRef.current = null;
    };
  }, [handleServerMessage]);

  // 消息列表变化时滚动到底部
  useEffect(() => {
    if (messages.length > 0) {
      listRef.current?.scrollToEnd({ animated: true });
    }
  }, [messages]);

  /** 发送文本 */
  const handleSend = useCallback(() => {
    const text = input.trim();
    const ws = wsRef.current;
    if (!ws || text.length === 0 || !ws.connected || sending) return;
    if (!ws.sendText(text)) return;
    setMessages((prev) => [...prev, { id: nextId(), role: 'user', text }]);
    setInput('');
    setSending(true);
  }, [input, sending]);

  /** 连接 / 断开（按当前状态切换） */
  const handleToggleConnect = useCallback(() => {
    const ws = wsRef.current;
    if (!ws) return;
    if (ws.connected || status === 'connecting') {
      ws.disconnect();
    } else {
      ws.connect(serverUrl.trim());
    }
  }, [serverUrl, status]);

  const info = statusInfo(status);
  const canSend = status === 'connected' && !sending && input.trim().length > 0;

  return (
    <View style={styles.container}>
      {/* 顶栏：标题 + 连接状态 */}
      <View style={styles.header}>
        <Text style={styles.title}>车机语音助手</Text>
        <View style={styles.statusWrap}>
          <View style={[styles.statusDot, { backgroundColor: info.color }]} />
          <Text style={[styles.statusText, { color: info.color }]}>{info.label}</Text>
        </View>
      </View>

      {/* 服务器地址行（调试用，T3.3 将迁入设置面板） */}
      <View style={styles.serverRow}>
        <TextInput
          style={styles.serverInput}
          value={serverUrl}
          onChangeText={setServerUrl}
          placeholder="ws://电脑IP:8080/ws"
          placeholderTextColor="#666666"
          autoCapitalize="none"
          autoCorrect={false}
        />
        <Pressable
          style={[styles.connectBtn, status === 'connected' || status === 'connecting' ? styles.connectBtnOn : null]}
          onPress={handleToggleConnect}
        >
          <Text style={styles.connectBtnText}>
            {status === 'disconnected' ? '连接' : '断开'}
          </Text>
        </Pressable>
      </View>

      {/* 对话区 */}
      <KeyboardAvoidingView
        style={styles.chatArea}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={0}
      >
        <FlatList
          ref={listRef}
          data={messages}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => (
            <View style={[styles.bubble, item.role === 'user' ? styles.bubbleUser : styles.bubbleAssistant]}>
              <Text style={styles.bubbleText}>
                {item.text}
                {item.streaming ? '▍' : ''}
              </Text>
            </View>
          )}
          contentContainerStyle={styles.listContent}
          ListEmptyComponent={
            <Text style={styles.emptyHint}>输入文字发送给 AI 试试（需先连接服务器）</Text>
          }
        />

        {/* LLM 重试进度提示 */}
        {llmStatus !== null && (
          <View style={styles.retryBanner}>
            <Text style={styles.retryText}>{llmStatus}</Text>
          </View>
        )}

        {/* 输入框 + 发送按钮 */}
        <View style={styles.inputRow}>
          <TextInput
            style={styles.input}
            value={input}
            onChangeText={setInput}
            placeholder="输入文字…"
            placeholderTextColor="#666666"
            editable={status === 'connected'}
            multiline={false}
            returnKeyType="send"
            onSubmitEditing={handleSend}
          />
          <Pressable
            style={[styles.sendBtn, canSend ? null : styles.sendBtnDisabled]}
            onPress={handleSend}
            disabled={!canSend}
          >
            <Text style={styles.sendBtnText}>{sending ? '生成中' : '发送'}</Text>
          </Pressable>
        </View>
      </KeyboardAvoidingView>

      <StatusBar style="light" />
    </View>
  );
}

/**
 * 注册根组件：package.json 的 main 直接指向本文件，
 * 必须显式调用 registerRootComponent（否则报 "main" has not been registered）
 */
registerRootComponent(App);

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#1a1a1a',
    paddingTop: 48,
    paddingHorizontal: 16,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#ffffff',
  },
  statusWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  statusDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  statusText: {
    fontSize: 14,
  },
  serverRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 12,
  },
  serverInput: {
    flex: 1,
    backgroundColor: '#2a2a2a',
    color: '#dddddd',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    fontSize: 13,
  },
  connectBtn: {
    backgroundColor: '#1976d2',
    borderRadius: 8,
    paddingHorizontal: 16,
    paddingVertical: 9,
  },
  connectBtnOn: {
    backgroundColor: '#555555',
  },
  connectBtnText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '600',
  },
  chatArea: {
    flex: 1,
  },
  listContent: {
    paddingBottom: 12,
    gap: 8,
  },
  emptyHint: {
    color: '#666666',
    textAlign: 'center',
    marginTop: 48,
    fontSize: 14,
  },
  bubble: {
    maxWidth: '80%',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  bubbleUser: {
    alignSelf: 'flex-end',
    backgroundColor: '#1976d2',
  },
  bubbleAssistant: {
    alignSelf: 'flex-start',
    backgroundColor: '#2f2f2f',
  },
  bubbleText: {
    color: '#ffffff',
    fontSize: 16,
    lineHeight: 22,
  },
  retryBanner: {
    alignItems: 'center',
    paddingVertical: 6,
  },
  retryText: {
    color: '#ffb300',
    fontSize: 13,
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#333333',
  },
  input: {
    flex: 1,
    backgroundColor: '#2a2a2a',
    color: '#ffffff',
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 10,
    fontSize: 16,
  },
  sendBtn: {
    backgroundColor: '#1976d2',
    borderRadius: 20,
    paddingHorizontal: 20,
    paddingVertical: 11,
  },
  sendBtnDisabled: {
    backgroundColor: '#3a3a3a',
  },
  sendBtnText: {
    color: '#ffffff',
    fontSize: 15,
    fontWeight: '600',
  },
});
