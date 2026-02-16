import React, { useEffect, useRef, useCallback, useMemo } from 'react';
import { View, Text, StyleSheet, Pressable, FlatList } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';
import { useRouter, Stack } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { colors, spacing, fontSize } from '@/constants/theme';
import { useGatewayContext } from '@/contexts/GatewayContext';
import { useVoice } from '@/hooks/useVoice';
import { VoiceOrb } from '@/components/VoiceOrb';
import { ChatBubble } from '@/components/ChatBubble';
import { TypingIndicator } from '@/components/ui/TypingIndicator';

export default function VoiceChatScreen() {
  const router = useRouter();
  const {
    connectionState,
    messages,
    streamingText,
    sendMessage,
    reconnect,
  } = useGatewayContext();

  const {
    voiceState,
    transcript,
    startListening,
    stopListening,
    stopSpeaking,
    setThinking,
    setOnFinalTranscript,
  } = useVoice();

  const flatListRef = useRef<FlatList>(null);
  const lastSpokenIdRef = useRef<string | null>(null);
  const isConnected = connectionState === 'connected';
  const isConnecting = connectionState === 'connecting' || connectionState === 'reconnecting';

  const statusColor = useMemo(() =>
    connectionState === 'connected' ? '#34C759'
      : connectionState === 'disconnected' ? '#FF3B30'
      : '#FFCC00',
    [connectionState],
  );

  // Auto-connect if gateway not yet connected
  useEffect(() => {
    if (connectionState === 'disconnected') {
      reconnect();
    }
  }, []);

  // Auto-start continuous listening when connected
  useEffect(() => {
    if (isConnected && voiceState === 'idle') {
      startListening(true);
    }
  }, [isConnected]);

  // Wire voice → gateway
  useEffect(() => {
    setOnFinalTranscript(async (text) => {
      setThinking();
      await sendMessage(text);
    });
  }, [setOnFinalTranscript, setThinking, sendMessage]);

  // Haptic on new assistant message
  useEffect(() => {
    if (messages.length === 0) return;
    const last = messages[messages.length - 1];
    if (last.role === 'assistant' && last.id !== lastSpokenIdRef.current) {
      lastSpokenIdRef.current = last.id;
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    }
  }, [messages]);

  const displayMessages = messages.slice(-10);

  // Auto-scroll
  useEffect(() => {
    if (displayMessages.length > 0) {
      setTimeout(() => flatListRef.current?.scrollToEnd({ animated: true }), 100);
    }
  }, [displayMessages.length]);

  // Tap: toggle listening on/off, or stop speaking
  const handleTap = useCallback(() => {
    if (!isConnected) return;

    if (voiceState === 'speaking') {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      stopSpeaking();
    } else if (voiceState === 'idle') {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      startListening(true);
    } else if (voiceState === 'listening') {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      stopListening();
    }
  }, [voiceState, isConnected, stopSpeaking, startListening, stopListening]);

  const hasMessages = displayMessages.length > 0 || !!streamingText;

  return (
    <>
      <Stack.Screen
        options={{
          headerTitle: () => (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: statusColor }} />
              <Text style={{ color: colors.text, fontSize: 17, fontWeight: '600' }}>Voice</Text>
            </View>
          ),
          headerLeft: () => (
            <Pressable onPress={() => router.push('/chat')} style={{ padding: spacing.xs }}>
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
            style={styles.messageList}
            contentContainerStyle={styles.messageContent}
            showsVerticalScrollIndicator={false}
          />
        )}

        {/* Streaming text area */}
        {streamingText ? (
          <Animated.View entering={FadeIn.duration(200)} style={styles.streamingArea}>
            <Text style={styles.streamingText}>{streamingText}</Text>
          </Animated.View>
        ) : voiceState === 'thinking' ? (
          <Animated.View entering={FadeIn.duration(200)} style={styles.streamingArea}>
            <TypingIndicator />
          </Animated.View>
        ) : null}

        {/* Voice orb */}
        <View style={[styles.orbSection, !hasMessages && styles.orbCentered]}>
          <VoiceOrb
            state={voiceState}
            transcript={transcript}
            onTap={handleTap}
            disabled={!isConnected}
            connecting={isConnecting}
          />
        </View>
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
  },
  streamingArea: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  streamingText: {
    color: colors.textSecondary,
    fontSize: fontSize.md,
    lineHeight: 22,
  },
  orbSection: {
    paddingVertical: spacing.xxl,
    paddingBottom: spacing.xxl + 20,
    alignItems: 'center',
  },
  orbCentered: {
    flex: 1,
    justifyContent: 'center',
  },
});
