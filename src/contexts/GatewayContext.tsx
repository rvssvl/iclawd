import React, { createContext, useContext, useEffect, useRef, useState, useCallback } from 'react';
import { AppState } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import * as Notifications from 'expo-notifications';
import { GatewayClient } from '@/services/GatewayClient';
import { getGatewayConfig } from '@/services/SecureStorage';
import { voiceEngine } from '@/services/VoiceEngine';
import type { ConnectionState, ChatMessage, GatewayConfig } from '@/types/gateway';

const KEY_AUTO_PRONOUNCE = 'iclawd_auto_pronounce';
const KEY_NOTIFICATIONS = 'iclawd_notifications';

// Suppress notification banners when app is in foreground — only show when backgrounded/closed
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: false,
    shouldPlaySound: false,
    shouldSetBadge: false,
    shouldShowBanner: false,
    shouldShowList: false,
  }),
});

interface GatewayContextValue {
  connectionState: ConnectionState;
  messages: ChatMessage[];
  streamingText: string;
  streamingId: string | null;
  sendMessage: (text: string) => Promise<void>;
  stopChat: () => Promise<void>;
  reconnect: () => Promise<void>;
}

const GatewayContext = createContext<GatewayContextValue | null>(null);

export function GatewayProvider({ children }: { children: React.ReactNode }) {
  const clientRef = useRef<GatewayClient | null>(null);
  const [connectionState, setConnectionState] = useState<ConnectionState>('disconnected');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [streamingText, setStreamingText] = useState('');
  const [streamingId, setStreamingId] = useState<string | null>(null);

  // Settings refs (read from SecureStore, updated by settings screen)
  const autoPronounceRef = useRef(true);
  const notificationsRef = useRef(true);
  const lastSpokenMsgIdRef = useRef<string | null>(null);

  // Load settings
  useEffect(() => {
    async function loadSettings() {
      const ap = await SecureStore.getItemAsync(KEY_AUTO_PRONOUNCE);
      const notif = await SecureStore.getItemAsync(KEY_NOTIFICATIONS);
      autoPronounceRef.current = ap !== 'false'; // default true
      notificationsRef.current = notif !== 'false'; // default true
    }
    loadSettings();

    // Reload settings when app comes to foreground (in case changed in settings)
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') loadSettings();
    });
    return () => sub.remove();
  }, []);

  function connectWithConfig(config: GatewayConfig) {
    clientRef.current?.disconnect();

    const client = new GatewayClient(config);
    clientRef.current = client;

    client.onConnectionChange(setConnectionState);

    client.onMessage((msg) => {
      setStreamingText('');
      setStreamingId(null);
      setMessages((prev) => {
        if (prev.some((m) => m.id === msg.id)) return prev;
        return [...prev, msg];
      });

      // Auto-pronounce and notify for assistant messages
      if (msg.role === 'assistant' && msg.id !== lastSpokenMsgIdRef.current) {
        lastSpokenMsgIdRef.current = msg.id;

        if (autoPronounceRef.current && AppState.currentState === 'active') {
          voiceEngine.speak(msg.content);
        }

        if (notificationsRef.current && AppState.currentState !== 'active') {
          Notifications.scheduleNotificationAsync({
            content: {
              title: 'Agent',
              body: msg.content.length > 200 ? msg.content.slice(0, 200) + '...' : msg.content,
            },
            trigger: null,
          }).catch(() => {});
        }
      }
    });

    client.onStream((text, msgId) => {
      setStreamingId(msgId);
      setStreamingText((prev) => prev + text);
    });

    client.connect().catch((err) => {
      console.warn('[Gateway] Connect failed:', err.message);
    });
  }

  useEffect(() => {
    let mounted = true;

    async function init() {
      const config = await getGatewayConfig();
      if (!config || !mounted) return;
      connectWithConfig(config);
    }

    init();

    return () => {
      mounted = false;
      clientRef.current?.disconnect();
    };
  }, []);

  const sendMessage = useCallback(async (text: string) => {
    if (!clientRef.current) return;

    const userMsg: ChatMessage = {
      id: `user-${Date.now()}`,
      role: 'user',
      content: text,
      timestamp: Date.now(),
    };
    setMessages((prev) => [...prev, userMsg]);
    setStreamingText('');

    await clientRef.current.sendChat(text);
  }, []);

  const stopChat = useCallback(async () => {
    await clientRef.current?.stopChat();
  }, []);

  const reconnect = useCallback(async () => {
    const config = await getGatewayConfig();
    if (config) {
      connectWithConfig(config);
    }
  }, []);

  const value: GatewayContextValue = {
    connectionState,
    messages,
    streamingText,
    streamingId,
    sendMessage,
    stopChat,
    reconnect,
  };

  return (
    <GatewayContext.Provider value={value}>
      {children}
    </GatewayContext.Provider>
  );
}

export function useGatewayContext(): GatewayContextValue {
  const ctx = useContext(GatewayContext);
  if (!ctx) {
    throw new Error('useGatewayContext must be used within GatewayProvider');
  }
  return ctx;
}
