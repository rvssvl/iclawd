import { useEffect, useRef, useState, useCallback } from 'react';
import { GatewayClient } from '@/services/GatewayClient';
import { getGatewayConfig } from '@/services/SecureStorage';
import type { ConnectionState, ChatMessage, GatewayConfig } from '@/types/gateway';
import { createLocalMessageId } from '@/utils/messageIds';

export function useGateway() {
  const clientRef = useRef<GatewayClient | null>(null);
  const [connectionState, setConnectionState] = useState<ConnectionState>('disconnected');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [streamingText, setStreamingText] = useState('');
  const [streamingId, setStreamingId] = useState<string | null>(null);
  const [awaitingResponse, setAwaitingResponse] = useState(false);
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
      setAwaitingResponse(false);
      setStreamingText('');
      setStreamingId(null);
      setMessages((prev) => [...prev, msg]);
    });

    client.onStream((text, msgId) => {
      setAwaitingResponse(false);
      setStreamingId(msgId);
      setStreamingText((prev) => prev + text);
    });

    client.onActivity((active) => {
      setAwaitingResponse(active);
    });

    client.connect().catch((err) => {
      console.warn('[Gateway] Connect failed:', err.message);
    });
  }

  const sendMessage = useCallback(async (text: string) => {
    if (!clientRef.current) return;

    const userMsg: ChatMessage = {
      id: createLocalMessageId('user'),
      role: 'user',
      content: text,
      timestamp: Date.now(),
    };
    setMessages((prev) => [...prev, userMsg]);
    setStreamingText('');
    setAwaitingResponse(false);

    try {
      await clientRef.current.sendChat(text);
      setAwaitingResponse(true);
    } catch (error) {
      setAwaitingResponse(false);
      const errMsg = error instanceof Error ? error.message : 'Failed to send message';
      setMessages((prev) => [
        ...prev,
        {
          id: createLocalMessageId('error'),
          role: 'assistant',
          content: `Message was not sent: ${errMsg}`,
          timestamp: Date.now(),
        },
      ]);
    }
  }, []);

  const stopChat = useCallback(async () => {
    setAwaitingResponse(false);
    await clientRef.current?.stopChat().catch((error) => {
      console.warn('[Gateway] Remote stop unavailable:', error instanceof Error ? error.message : error);
    });
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
    awaitingResponse,
    sendMessage,
    stopChat,
    reconnect,
  };
}
