import { useState, useRef, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  TextInput,
  StyleSheet,
  Pressable,
  FlatList,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter, Stack } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { colors, spacing, fontSize, borderRadius } from '@/constants/theme';
import { useGatewayContext } from '@/contexts/GatewayContext';
import { useVoice } from '@/hooks/useVoice';
import { track, trackOnce } from '@/services/AnalyticsService';
import { ChatBubble } from '@/components/ChatBubble';
import { TypingIndicator } from '@/components/ui/TypingIndicator';
import type { ChatMessage } from '@/types/gateway';

export default function ChatScreen() {
  const router = useRouter();
  const {
    connectionState,
    messages,
    streamingText,
    streamingId,
    awaitingResponse,
    connectionError,
    sendMessage,
    reconnect,
  } = useGatewayContext();

  const [input, setInput] = useState('');
  const [dictating, setDictating] = useState(false);
  const flatListRef = useRef<FlatList>(null);
  const inputRef = useRef<TextInput>(null);
  const dictationBaseRef = useRef('');
  const insets = useSafeAreaInsets();
  const {
    voiceState,
    inputProvider,
    transcript,
    startListening,
    stopListening,
    stopSpeaking,
    suspend,
    setOnFinalTranscript,
  } = useVoice();

  const isConnected = connectionState === 'connected';
  const hasConnectionProblem = connectionState === 'error' || connectionState === 'disconnected';

  // Auto-connect if gateway not yet connected
  useEffect(() => {
    if (connectionState === 'disconnected') {
      reconnect();
    }
  }, [connectionState, reconnect]);

  // Build display messages including streaming
  const displayMessages: ChatMessage[] = [
    ...messages,
    ...(streamingText
      ? [{
          id: `streaming-${streamingId || 'pending'}`,
          role: 'assistant' as const,
          content: streamingText,
          timestamp: Date.now(),
          streaming: true,
        }]
      : []),
  ];

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    if (displayMessages.length > 0 || awaitingResponse) {
      setTimeout(() => flatListRef.current?.scrollToEnd({ animated: true }), 100);
    }
  }, [displayMessages.length, streamingText, awaitingResponse]);

  async function handleSend() {
    const text = input.trim();
    if (!text || !isConnected) return;
    setInput('');
    await sendMessage(text);
  }

  function openVoiceMode() {
    Haptics.selectionAsync();
    router.push('/voice');
  }

  useFocusEffect(
    useCallback(() => {
      return () => {
        setDictating(false);
        suspend();
      };
    }, [suspend]),
  );

  useEffect(() => {
    setOnFinalTranscript((text) => {
      const nextText = [dictationBaseRef.current.trim(), text.trim()]
        .filter(Boolean)
        .join(' ');
      setInput(nextText);
      setDictating(false);
      inputRef.current?.focus();
    });
  }, [setOnFinalTranscript]);

  useEffect(() => {
    if (!dictating || !transcript.trim()) return;
    const nextText = [dictationBaseRef.current.trim(), transcript.trim()]
      .filter(Boolean)
      .join(' ');
    setInput(nextText);
  }, [dictating, transcript]);

  async function toggleDictation() {
    if (!isConnected) return;

    if (voiceState === 'speaking' || voiceState === 'preparingAudio') {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      await stopSpeaking();
      return;
    }

    if (dictating || voiceState === 'listening') {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      await stopListening();
      setDictating(false);
      inputRef.current?.focus();
      return;
    }

    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
    track('voice_started', { screen: 'chat', provider: inputProvider });
    trackOnce('first_voice_started', { screen: 'chat', provider: inputProvider });
    dictationBaseRef.current = input;
    setDictating(true);
    inputRef.current?.blur();
    await startListening(false);
  }

  async function handleStopAudio() {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    await stopSpeaking();
  }

  return (
    <>
      <Stack.Screen
        options={{
          headerLeft: () => (
            <Pressable onPress={openVoiceMode} style={styles.headerIconButton}>
              <Ionicons name="headset-outline" size={22} color={colors.textSecondary} style={styles.headerIcon} />
            </Pressable>
          ),
          headerRight: () => (
            <Pressable onPress={() => router.push('/settings')} style={styles.headerIconButton}>
              <Ionicons name="settings-outline" size={22} color={colors.textSecondary} style={styles.headerIcon} />
            </Pressable>
          ),
          headerTitle: 'ClawVoice',
        }}
      />

      <KeyboardAvoidingView
        style={styles.container}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 56 + insets.top : 0}
      >
        {/* Messages */}
        {displayMessages.length === 0 ? (
          <View style={styles.emptyState}>
            <Ionicons name="chatbubble-ellipses-outline" size={48} color={colors.textMuted} />
            <Text style={styles.emptyTitle}>
              {connectionState === 'connected'
                ? 'Start a conversation'
                : hasConnectionProblem
                  ? 'Could not connect'
                  : 'Connecting to your agent...'}
            </Text>
            <Text style={styles.emptySubtitle}>
              {connectionState === 'connected'
                ? 'Type a message or use voice mode'
                : connectionError || 'Make sure your gateway is running'}
            </Text>
            {hasConnectionProblem && (
              <Pressable style={styles.retryButton} onPress={reconnect}>
                <Ionicons name="refresh" size={16} color={colors.text} />
                <Text style={styles.retryButtonText}>Reconnect</Text>
              </Pressable>
            )}
          </View>
        ) : (
          <FlatList
            ref={flatListRef}
            data={displayMessages}
            keyExtractor={(item) => item.id}
            renderItem={({ item }) => <ChatBubble message={item} />}
            ListFooterComponent={awaitingResponse && !streamingText ? (
              <View style={styles.awaitingIndicator}>
                <TypingIndicator />
              </View>
            ) : null}
            contentContainerStyle={styles.messageList}
            showsVerticalScrollIndicator={false}
          />
        )}

        {!isConnected && connectionError && displayMessages.length > 0 && (
          <View style={styles.connectionBanner}>
            <Ionicons name="warning-outline" size={16} color={colors.warning} />
            <Text style={styles.connectionBannerText} numberOfLines={2}>{connectionError}</Text>
            <Pressable onPress={reconnect} hitSlop={8}>
              <Ionicons name="refresh" size={18} color={colors.textSecondary} />
            </Pressable>
          </View>
        )}

        {/* Input bar */}
        <View style={[styles.inputBar, { paddingBottom: Math.max(insets.bottom, spacing.md) }]}>
          <Pressable
            style={[styles.voiceButton, dictating && styles.voiceButtonActive]}
            onPress={toggleDictation}
            disabled={
              connectionState !== 'connected'
              || voiceState === 'speaking'
              || voiceState === 'preparingAudio'
              || voiceState === 'thinking'
            }
          >
            <Ionicons
              name={dictating || voiceState === 'listening' ? 'stop' : 'mic'}
              size={22}
              color={dictating || voiceState === 'listening' ? colors.text : colors.primaryLight}
            />
          </Pressable>

          <TextInput
            ref={inputRef}
            style={styles.textInput}
            value={input}
            onChangeText={setInput}
            placeholder={dictating
              ? voiceState === 'thinking' ? 'Transcribing...' : 'Listening...'
              : connectionState === 'connected'
                ? 'Message your agent...'
                : 'Not connected'}
            placeholderTextColor={colors.textMuted}
            multiline
            maxLength={4000}
            editable={isConnected && !dictating && voiceState !== 'thinking'}
          />

          {voiceState === 'speaking' || voiceState === 'preparingAudio' ? (
            <Pressable style={styles.stopButton} onPress={handleStopAudio}>
              <Ionicons name="volume-high" size={14} color={colors.error} />
              <Text style={styles.stopButtonText}>
                {voiceState === 'preparingAudio' ? 'Cancel audio' : 'Stop audio'}
              </Text>
            </Pressable>
          ) : (
            <Pressable
              style={[styles.sendButton, (!input.trim() || !isConnected) && styles.sendButtonDisabled]}
              onPress={handleSend}
              disabled={!input.trim() || !isConnected}
            >
              <Ionicons name="arrow-up" size={18} color={colors.text} />
            </Pressable>
          )}
        </View>
      </KeyboardAvoidingView>
    </>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  headerIconButton: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerIcon: {
    width: 22,
    height: 22,
    lineHeight: 22,
    textAlign: 'center',
    transform: [{ translateY: -2 }],
  },
  messageList: {
    paddingVertical: spacing.md,
  },
  awaitingIndicator: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    alignItems: 'flex-start',
  },
  emptyState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    padding: spacing.xl,
  },
  emptyTitle: {
    fontSize: fontSize.lg,
    fontWeight: '600',
    color: colors.textSecondary,
    marginTop: spacing.sm,
  },
  emptySubtitle: {
    fontSize: fontSize.sm,
    color: colors.textMuted,
    textAlign: 'center',
  },
  retryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    backgroundColor: colors.primary,
    borderRadius: borderRadius.full,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    marginTop: spacing.sm,
  },
  retryButtonText: {
    fontSize: fontSize.sm,
    fontWeight: '600',
    color: colors.text,
  },
  connectionBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginHorizontal: spacing.sm,
    marginBottom: spacing.xs,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: borderRadius.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  connectionBannerText: {
    flex: 1,
    fontSize: fontSize.sm,
    color: colors.textSecondary,
  },
  inputBar: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    padding: spacing.sm,
    gap: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.background,
  },
  voiceButton: {
    width: 40,
    height: 40,
    borderRadius: borderRadius.full,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  voiceButtonActive: {
    backgroundColor: colors.voiceListening,
  },
  textInput: {
    flex: 1,
    backgroundColor: colors.surface,
    borderRadius: borderRadius.lg,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    fontSize: fontSize.md,
    color: colors.text,
    maxHeight: 100,
    minHeight: 40,
  },
  sendButton: {
    width: 36,
    height: 36,
    borderRadius: borderRadius.full,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendButtonDisabled: {
    backgroundColor: colors.surfaceLight,
  },
  stopButton: {
    paddingHorizontal: spacing.sm,
    height: 36,
    borderRadius: borderRadius.full,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: spacing.xs,
    borderWidth: 1,
    borderColor: colors.error,
  },
  stopButtonText: {
    color: colors.error,
    fontSize: fontSize.xs,
    fontWeight: '600',
  },
});
