import { useEffect, useRef, useState, useCallback } from 'react';
import { GatewayClient } from '@/services/GatewayClient';
import { getGatewayConfig } from '@/services/SecureStorage';
import type { ConnectionState, ChatMessage, GatewayConfig } from '@/types/gateway';

export function useGateway() {
  const clientRef = useRef<GatewayClient | null>(null);
  const [connectionState, setConnectionState] = useState<ConnectionState>('disconnected');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [streamingText, setStreamingText] = useState('');
  const [streamingId, setStreamingId] = useState<string | null>(null);
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

  function connectWithConfig(config: GatewayConfig) {
    // Clean up previous
    clientRef.current?.disconnect();

    const client = new GatewayClient(config);
    clientRef.current = client;

    client.onConnectionChange(setConnectionState);

    client.onMessage((msg) => {
      setStreamingText('');
      setStreamingId(null);
      setMessages((prev) => [...prev, msg]);
    });

    client.onStream((text, msgId) => {
      setStreamingId(msgId);
      setStreamingText((prev) => prev + text);
    });

    client.connect().catch((err) => {
      console.warn('[Gateway] Connect failed:', err.message);
    });
  }

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

  return {
    connectionState,
    messages,
    streamingText,
    streamingId,
    sendMessage,
    stopChat,
    reconnect,
  };
}
