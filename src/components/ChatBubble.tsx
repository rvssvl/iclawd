import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import * as Clipboard from 'expo-clipboard';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing, fontSize, lineHeight } from '@/constants/theme';
import { AnimatedMessage } from '@/components/ui/AnimatedMessage';
import type { ChatMessage } from '@/types/gateway';

function BlinkingCursor() {
  const opacity = useSharedValue(1);

  useEffect(() => {
    opacity.value = withRepeat(withTiming(0, { duration: 500 }), -1, true);
  }, []);

  const style = useAnimatedStyle(() => ({ opacity: opacity.value }));

  return (
    <Animated.Text style={[cursorStyles.cursor, style]}>|</Animated.Text>
  );
}

const cursorStyles = StyleSheet.create({
  cursor: {
    color: colors.primaryLight,
    fontSize: fontSize.md,
    fontWeight: '300',
  },
});

interface Props {
  message: ChatMessage;
}

export function ChatBubble({ message }: Props) {
  const isUser = message.role === 'user';
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    await Clipboard.setStringAsync(message.content);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <AnimatedMessage direction={isUser ? 'right' : 'left'}>
      <View style={[styles.row, isUser ? styles.userRow : styles.assistantRow]}>
        {!isUser && (
          <View style={styles.avatar}>
            <Text style={styles.avatarEmoji}>🦀</Text>
          </View>
        )}
        <View style={isUser ? styles.userBubble : styles.assistantPlain}>
          <Text style={[styles.text, isUser && styles.userText]}>
            {message.content}
            {message.streaming && <BlinkingCursor />}
          </Text>
          {!isUser && !message.streaming && (
            <Pressable onPress={handleCopy} hitSlop={8} style={styles.copyButton}>
              <Ionicons
                name={copied ? 'checkmark' : 'copy-outline'}
                size={14}
                color={copied ? colors.success : colors.textMuted}
              />
            </Pressable>
          )}
        </View>
      </View>
    </AnimatedMessage>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    paddingHorizontal: spacing.md,
    marginVertical: spacing.xs,
  },
  userRow: {
    justifyContent: 'flex-end',
  },
  assistantRow: {
    justifyContent: 'flex-start',
    alignItems: 'flex-start',
  },
  avatar: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: colors.surface,
    marginRight: spacing.sm,
    marginTop: 2,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  },
  avatarEmoji: {
    fontSize: 16,
    lineHeight: 20,
  },
  userBubble: {
    backgroundColor: colors.primary,
    borderRadius: 20,
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
    maxWidth: '85%',
  },
  assistantPlain: {
    flex: 1,
    paddingVertical: spacing.xs,
  },
  text: {
    color: colors.text,
    fontSize: fontSize.md,
    lineHeight: lineHeight.normal,
  },
  userText: {
    color: '#FFFFFF',
  },
  copyButton: {
    alignSelf: 'flex-start',
    marginTop: 4,
    padding: 2,
  },
});
