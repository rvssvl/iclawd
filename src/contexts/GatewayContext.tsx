import React, { createContext, useContext, useEffect, useRef, useState, useCallback } from 'react';
import { AppState } from 'react-native';
import * as SecureStore from '@/services/SafeSecureStore';
import type * as ExpoNotifications from 'expo-notifications';
import { GatewayClient } from '@/services/GatewayClient';
import { getGatewayConfig } from '@/services/SecureStorage';
import {
  gatewayProfileToConfig,
  getActiveGatewayProfile,
  markGatewayProfileConnected,
} from '@/services/GatewayProfiles';
import {
  appendConversationMessage,
  loadConversationHistory,
  saveConversationHistory,
} from '@/services/ConversationHistory';
import { voiceEngine } from '@/services/VoiceEngine';
import { categorizeError, track, trackOnce } from '@/services/AnalyticsService';
import type { ConnectionState, ChatMessage, GatewayConfig } from '@/types/gateway';
import { createLocalMessageId } from '@/utils/messageIds';
import { prepareAssistantSpeechText, rememberAssistantSpeech } from '@/utils/assistantSpeechText';

const KEY_AUTO_PRONOUNCE = 'iclawd_auto_pronounce';
const KEY_NOTIFICATIONS = 'iclawd_notifications';
const RESPONSE_START_TIMEOUT_MS = 45000;

// Suppress notification banners when app is in foreground — only show when backgrounded/closed
function getNotifications(): typeof ExpoNotifications | null {
  if (__DEV__) return null;
  return require('expo-notifications') as typeof ExpoNotifications;
}

const initialNotifications = getNotifications();
if (initialNotifications) {
  initialNotifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowAlert: false,
      shouldPlaySound: false,
      shouldSetBadge: false,
      shouldShowBanner: false,
      shouldShowList: false,
    }),
  });
}

interface GatewayContextValue {
  connectionState: ConnectionState;
  messages: ChatMessage[];
  streamingText: string;
  streamingId: string | null;
  awaitingResponse: boolean;
  connectionError: string | null;
  sendMessage: (text: string) => Promise<void>;
  stopChat: () => Promise<void>;
  reconnect: () => Promise<void>;
  activeGatewayId: string | null;
}

const GatewayContext = createContext<GatewayContextValue | null>(null);

export function GatewayProvider({ children }: { children: React.ReactNode }) {
  const clientRef = useRef<GatewayClient | null>(null);
  const [connectionState, setConnectionState] = useState<ConnectionState>('connecting');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [streamingText, setStreamingText] = useState('');
  const [streamingId, setStreamingId] = useState<string | null>(null);
  const [awaitingResponse, setAwaitingResponse] = useState(false);
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [activeGatewayId, setActiveGatewayId] = useState<string | null>(null);
  const stoppedResponseRef = useRef(false);
  const activeGatewayIdRef = useRef<string | null>(null);
  const responseStartTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Settings refs (read from SecureStore, updated by settings screen)
  const autoPronounceRef = useRef(true);
  const notificationsRef = useRef(true);
  const lastSpokenMsgIdRef = useRef<string | null>(null);

  function clearResponseStartTimer() {
    if (responseStartTimerRef.current) {
      clearTimeout(responseStartTimerRef.current);
      responseStartTimerRef.current = null;
    }
  }

  function beginResponseStartTimer() {
    clearResponseStartTimer();
    responseStartTimerRef.current = setTimeout(() => {
      responseStartTimerRef.current = null;
      setAwaitingResponse(false);
      setStreamingText('');
      setStreamingId(null);
      const timeoutMessage: ChatMessage = {
        id: createLocalMessageId('gateway-timeout'),
        role: 'assistant',
        content: 'Your gateway accepted the message but did not start a response within 45 seconds. It may still be working; check the gateway logs before sending another message.',
        timestamp: Date.now(),
      };
      setMessages((previous) => {
        const next = [...previous, timeoutMessage];
        if (activeGatewayIdRef.current) {
          appendConversationMessage(activeGatewayIdRef.current, timeoutMessage).catch(() => {});
        }
        return next;
      });
    }, RESPONSE_START_TIMEOUT_MS);
  }

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

  async function connectWithActiveProfile() {
    const profile = await getActiveGatewayProfile();
    if (!profile) {
      setActiveGatewayId(null);
      activeGatewayIdRef.current = null;
      setMessages([]);
      setConnectionState('disconnected');
      return;
    }

    setActiveGatewayId(profile.id);
    activeGatewayIdRef.current = profile.id;
    setMessages(await loadConversationHistory(profile.id));
    connectWithConfig(gatewayProfileToConfig(profile), profile.id);
  }

  function connectWithConfig(config: GatewayConfig, profileId?: string) {
    clientRef.current?.disconnect();
    clearResponseStartTimer();
    setConnectionError(null);

    const client = new GatewayClient(config);
    clientRef.current = client;

    client.onConnectionChange((state) => {
      setConnectionState(state);
      if (state === 'connected' || state === 'connecting') {
        setConnectionError(null);
      }
      if (state === 'connected' && profileId) {
        markGatewayProfileConnected(profileId).catch(() => {});
      }
    });

    client.onError(setConnectionError);

    client.onMessage((msg) => {
      clearResponseStartTimer();
      if (stoppedResponseRef.current) {
        setAwaitingResponse(false);
        setStreamingText('');
        setStreamingId(null);
        return;
      }

      setAwaitingResponse(false);
      setStreamingText('');
      setStreamingId(null);
      setMessages((prev) => {
        if (prev.some((m) => m.id === msg.id)) return prev;
        const next = [...prev, msg];
        if (activeGatewayIdRef.current) {
          saveConversationHistory(activeGatewayIdRef.current, next).catch(() => {});
        }
        return next;
      });

      // Auto-pronounce and notify for assistant messages
      if (msg.role === 'assistant' && msg.id !== lastSpokenMsgIdRef.current) {
        lastSpokenMsgIdRef.current = msg.id;
        trackOnce('first_agent_response_received');

        if (autoPronounceRef.current) {
          const speechText = prepareAssistantSpeechText(msg.content);
          if (speechText) {
            voiceEngine.speak(speechText)
              .then(() => {
                rememberAssistantSpeech(speechText);
              })
              .catch((error) => {
                track('voice_tts_failed', {
                  provider: 'unknown',
                  error_category: categorizeError(error),
                });
                console.warn('[Voice] Auto-pronounce failed:', error instanceof Error ? error.message : error);
              });
          }
        }

        const notifications = getNotifications();
        if (notifications && notificationsRef.current && AppState.currentState !== 'active') {
          notifications.scheduleNotificationAsync({
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
      clearResponseStartTimer();
      if (stoppedResponseRef.current) return;

      setAwaitingResponse(false);
      setStreamingId(msgId);
      setStreamingText((prev) => prev + text);
    });

    client.onActivity((active) => {
      clearResponseStartTimer();
      if (stoppedResponseRef.current) {
        if (!active) {
          stoppedResponseRef.current = false;
        }
        setAwaitingResponse(false);
        return;
      }
      setAwaitingResponse(active);
    });

    client.connect().catch((err) => {
      const message = err instanceof Error ? err.message : 'Could not connect to gateway';
      track('connect_failed', { error_category: categorizeError(message) });
      setConnectionError(message);
      console.warn('[Gateway] Connect failed:', message);
    });
  }

  useEffect(() => {
    let mounted = true;

    async function init() {
      const config = await getGatewayConfig();
      if (!mounted) return;
      if (!config) {
        setConnectionState('disconnected');
        return;
      }
      await connectWithActiveProfile();
    }

    init();

    return () => {
      mounted = false;
      clearResponseStartTimer();
      clientRef.current?.disconnect();
    };
  }, []);

  const sendMessage = useCallback(async (text: string) => {
    if (!clientRef.current) return;

    const userMsg: ChatMessage = {
      id: createLocalMessageId('user'),
      role: 'user',
      content: text,
      timestamp: Date.now(),
    };
    setMessages((prev) => [...prev, userMsg]);
    if (activeGatewayIdRef.current) {
      appendConversationMessage(activeGatewayIdRef.current, userMsg).catch(() => {});
    }
    setStreamingText('');
    setAwaitingResponse(false);
    clearResponseStartTimer();
    stoppedResponseRef.current = false;

    try {
      await clientRef.current.sendChat(text);
      trackOnce('first_chat_sent');
      setAwaitingResponse(true);
      beginResponseStartTimer();
    } catch (error) {
      clearResponseStartTimer();
      setAwaitingResponse(false);
      const errMsg = error instanceof Error ? error.message : 'Failed to send message';
      const systemMsg: ChatMessage = {
        id: createLocalMessageId('error'),
        role: 'assistant',
        content: `Message was not sent: ${errMsg}`,
        timestamp: Date.now(),
      };
      setMessages((prev) => [...prev, systemMsg]);
      if (activeGatewayIdRef.current) {
        appendConversationMessage(activeGatewayIdRef.current, systemMsg).catch(() => {});
      }
    }
  }, []);

  const stopChat = useCallback(async () => {
    stoppedResponseRef.current = true;
    clearResponseStartTimer();
    setAwaitingResponse(false);
    setStreamingText('');
    setStreamingId(null);
    await clientRef.current?.stopChat().catch((error) => {
      console.warn('[Gateway] Remote stop unavailable:', error instanceof Error ? error.message : error);
    });
  }, []);

  const reconnect = useCallback(async () => {
    const profile = await getActiveGatewayProfile();
    if (profile) {
      setActiveGatewayId(profile.id);
      activeGatewayIdRef.current = profile.id;
      setMessages(await loadConversationHistory(profile.id));
      connectWithConfig(gatewayProfileToConfig(profile), profile.id);
    } else {
      activeGatewayIdRef.current = null;
      setActiveGatewayId(null);
      setMessages([]);
      setConnectionState('disconnected');
      setConnectionError('No gateway is configured');
    }
  }, []);

  const value: GatewayContextValue = {
    connectionState,
    messages,
    streamingText,
    streamingId,
    awaitingResponse,
    connectionError,
    sendMessage,
    stopChat,
    reconnect,
    activeGatewayId,
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
