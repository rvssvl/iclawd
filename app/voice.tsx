import React, { useEffect, useRef, useCallback, useMemo } from 'react';
import { View, Text, StyleSheet, Pressable, FlatList } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';
import { useFocusEffect, useRouter, Stack } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { colors, spacing, fontSize } from '@/constants/theme';
import { useGatewayContext } from '@/contexts/GatewayContext';
import { useVoiceConversation } from '@/hooks/useVoiceConversation';
import { VoiceOrb } from '@/components/VoiceOrb';
import { ChatBubble } from '@/components/ChatBubble';
import { TypingIndicator } from '@/components/ui/TypingIndicator';
import type { ChatMessage } from '@/types/gateway';

const ORB_DOCK_HEIGHT = 238;
const ORB_FADE_STEPS = [0.02, 0.08, 0.18, 0.34, 0.56, 0.78, 0.94];

export default function VoiceChatScreen() {
  const router = useRouter();
  const {
    connectionState,
    messages,
    streamingText,
    streamingId,
    awaitingResponse,
    sendMessage,
    reconnect,
  } = useGatewayContext();

  const flatListRef = useRef<FlatList>(null);
  const lastSpokenIdRef = useRef<string | null>(null);
  const isConnected = connectionState === 'connected';
  const isConnecting = connectionState === 'connecting' || connectionState === 'reconnecting';
  const latestAssistantId = useMemo(() => {
    const lastAssistant = [...messages].reverse().find((message) => message.role === 'assistant');
    return lastAssistant?.id || null;
  }, [messages]);

  const {
    conversationState,
    orbState,
    transcript,
    statusLabel,
    toggleMic,
    pause,
    isBusy,
  } = useVoiceConversation({
    connectionState,
    awaitingResponse,
    streamingText,
    latestAssistantId,
    sendMessage,
    reconnect,
  });

  useFocusEffect(
    useCallback(() => {
      return () => {
        pause();
      };
    }, [pause]),
  );

  // Auto-connect if gateway not yet connected
  useEffect(() => {
    if (connectionState === 'disconnected') {
      reconnect();
    }
  }, []);

  // Haptic on new assistant message
  useEffect(() => {
    if (messages.length === 0) return;
    const last = messages[messages.length - 1];
    if (last.role === 'assistant' && last.id !== lastSpokenIdRef.current) {
      lastSpokenIdRef.current = last.id;
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    }
  }, [messages]);

  const displayMessages: ChatMessage[] = [
    ...messages,
    ...(streamingText
      ? [{
          id: `voice-streaming-${streamingId || 'pending'}`,
          role: 'assistant' as const,
          content: streamingText,
          timestamp: Date.now(),
          streaming: true,
        }]
      : []),
  ].slice(-10);

  // Auto-scroll
  useEffect(() => {
    if (displayMessages.length > 0 || awaitingResponse) {
      setTimeout(() => flatListRef.current?.scrollToEnd({ animated: true }), 100);
    }
  }, [awaitingResponse, displayMessages.length, streamingText]);

  const handleChatPress = useCallback(() => {
    Haptics.selectionAsync();
    router.push('/chat');
  }, [router]);

  const hasMessages = displayMessages.length > 0 || awaitingResponse;

  return (
    <>
      <Stack.Screen
        options={{
          headerTitle: () => (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <Text style={{ color: colors.text, fontSize: 17, fontWeight: '600' }}>Voice</Text>
            </View>
          ),
          headerLeft: () => (
            <Pressable onPress={handleChatPress} style={{ padding: spacing.xs }}>
              <Ionicons name="chatbubble-outline" size={22} color={colors.textSecondary} />
            </Pressable>
          ),
          headerRight: () => (
            <Pressable onPress={() => router.push('/settings')} style={{ padding: spacing.xs }}>
              <Ionicons name="settings-outline" size={22} color={colors.textSecondary} />
            </Pressable>
          ),
        }}
      />

      <View style={styles.container}>
        {/* Conversation history */}
        {hasMessages && (
          <FlatList
            ref={flatListRef}
            data={displayMessages}
            keyExtractor={(item) => item.id}
            renderItem={({ item }) => <ChatBubble message={item} />}
            ListFooterComponent={awaitingResponse && !streamingText ? <TypingIndicator /> : null}
            style={styles.messageList}
            contentContainerStyle={styles.messageContent}
            showsVerticalScrollIndicator={false}
          />
        )}

        {/* Voice orb */}
        <Animated.View entering={FadeIn.duration(200)} style={hasMessages ? styles.orbDock : styles.orbCentered}>
          {hasMessages && (
            <View pointerEvents="none" style={styles.dockBackdrop}>
              <View style={styles.dockFade}>
                {ORB_FADE_STEPS.map((opacity, index) => (
                  <View
                    key={opacity}
                    style={[
                      styles.fadeStep,
                      {
                        opacity,
                        top: `${(index / ORB_FADE_STEPS.length) * 100}%`,
                        height: `${100 / ORB_FADE_STEPS.length + 1}%`,
                      },
                    ]}
                  />
                ))}
              </View>
              <View style={styles.dockSolid} />
            </View>
          )}
          <VoiceOrb
            state={orbState}
            transcript={transcript}
            onTap={toggleMic}
            disabled={!isConnected}
            connecting={isConnecting}
            busy={isBusy}
            statusLabel={statusLabel}
          />
        </Animated.View>
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  messageList: {
    flex: 1,
  },
  messageContent: {
    paddingVertical: spacing.lg,
    paddingHorizontal: spacing.xs,
    paddingBottom: ORB_DOCK_HEIGHT + spacing.lg,
  },
  orbDock: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: ORB_DOCK_HEIGHT,
    paddingTop: spacing.md,
    paddingBottom: spacing.xxl,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dockBackdrop: {
    ...StyleSheet.absoluteFillObject,
  },
  dockFade: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    height: 84,
  },
  fadeStep: {
    position: 'absolute',
    left: 0,
    right: 0,
    backgroundColor: colors.background,
  },
  dockSolid: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 70,
    bottom: 0,
    backgroundColor: colors.background,
  },
  orbCentered: {
    flex: 1,
    paddingBottom: spacing.xxl + 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
