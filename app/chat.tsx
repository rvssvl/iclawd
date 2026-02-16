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
import { useRouter, Stack } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing, fontSize, borderRadius } from '@/constants/theme';
import { useGatewayContext } from '@/contexts/GatewayContext';
import { ChatBubble } from '@/components/ChatBubble';
import type { ChatMessage } from '@/types/gateway';

export default function ChatScreen() {
  const router = useRouter();
  const {
    connectionState,
    messages,
    streamingText,
    streamingId,
    sendMessage,
    stopChat,
    reconnect,
  } = useGatewayContext();

  const [input, setInput] = useState('');
  const flatListRef = useRef<FlatList>(null);
  const inputRef = useRef<TextInput>(null);
  const insets = useSafeAreaInsets();

  // Auto-connect if gateway not yet connected
  useEffect(() => {
    if (connectionState === 'disconnected') {
      reconnect();
    }
  }, []);

  // Build display messages including streaming
  const displayMessages: ChatMessage[] = [
    ...messages,
    ...(streamingText
      ? [{
          id: streamingId || 'streaming',
          role: 'assistant' as const,
          content: streamingText,
          timestamp: Date.now(),
          streaming: true,
        }]
      : []),
  ];

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    if (displayMessages.length > 0) {
      setTimeout(() => flatListRef.current?.scrollToEnd({ animated: true }), 100);
    }
  }, [displayMessages.length, streamingText]);

  async function handleSend() {
    const text = input.trim();
    if (!text || connectionState !== 'connected') return;
    setInput('');
    await sendMessage(text);
  }

  return (
    <>
      <Stack.Screen
        options={{
          headerLeft: () => (
            <Pressable onPress={() => router.push('/voice')} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, padding: spacing.xs }}>
              <View style={{
                width: 8, height: 8, borderRadius: 4,
                backgroundColor: connectionState === 'connected' ? '#34C759'
                  : connectionState === 'disconnected' ? '#FF3B30' : '#FFCC00',
              }} />
              <Ionicons name="mic" size={22} color={colors.textSecondary} />
            </Pressable>
          ),
          headerRight: () => (
            <Pressable onPress={() => router.push('/settings')} style={{ padding: spacing.xs }}>
              <Ionicons name="settings-outline" size={22} color={colors.textSecondary} />
            </Pressable>
          ),
          headerTitle: 'iClawd',
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
                : 'Connecting to your agent...'}
            </Text>
            <Text style={styles.emptySubtitle}>
              {connectionState === 'connected'
                ? 'Type a message or use voice mode'
                : 'Make sure your gateway is running'}
            </Text>
          </View>
        ) : (
          <FlatList
            ref={flatListRef}
            data={displayMessages}
            keyExtractor={(item) => item.id}
            renderItem={({ item }) => <ChatBubble message={item} />}
            contentContainerStyle={styles.messageList}
            showsVerticalScrollIndicator={false}
          />
        )}

        {/* Input bar */}
        <View style={[styles.inputBar, { paddingBottom: Math.max(insets.bottom, spacing.md) }]}>
          <Pressable style={styles.voiceButton} onPress={() => router.push('/voice')}>
            <Ionicons name="mic" size={22} color={colors.primaryLight} />
          </Pressable>

          <TextInput
            ref={inputRef}
            style={styles.textInput}
            value={input}
            onChangeText={setInput}
            placeholder={connectionState === 'connected' ? 'Message your agent...' : 'Not connected'}
            placeholderTextColor={colors.textMuted}
            multiline
            maxLength={4000}
            editable={connectionState === 'connected'}
          />

          {streamingText ? (
            <Pressable style={styles.stopButton} onPress={stopChat}>
              <Ionicons name="stop" size={18} color={colors.error} />
            </Pressable>
          ) : (
            <Pressable
              style={[styles.sendButton, (!input.trim() || connectionState !== 'connected') && styles.sendButtonDisabled]}
              onPress={handleSend}
              disabled={!input.trim() || connectionState !== 'connected'}
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
  messageList: {
    paddingVertical: spacing.md,
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
    width: 36,
    height: 36,
    borderRadius: borderRadius.full,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.error,
  },
});
