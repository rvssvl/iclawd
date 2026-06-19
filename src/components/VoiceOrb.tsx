import { useEffect } from 'react';
import { StyleSheet, Pressable, View, Text } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withTiming,
  withSequence,
  withDelay,
  withSpring,
  Easing,
  cancelAnimation,
} from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import type { VoiceState } from '@/services/VoiceEngine';
import { colors, fontSize, spacing, animation } from '@/constants/theme';

const ORB_SIZE = 96;
const GLOW_SIZE = ORB_SIZE + 20;

interface Props {
  state: VoiceState;
  transcript?: string;
  onTap: () => void;
  disabled?: boolean;
  connecting?: boolean;
  busy?: boolean;
  statusLabel?: string;
}

export function VoiceOrb({ state, transcript, onTap, disabled, connecting, busy, statusLabel }: Props) {
  const orbScale = useSharedValue(1);
  const glowOpacity = useSharedValue(0);
  const glowScale = useSharedValue(1);

  const isListening = state === 'listening';
  const isProcessing = state === 'thinking' || state === 'preparingAudio' || state === 'speaking';
  const iconName = state === 'speaking'
    ? 'volume-high'
    : state === 'listening'
      ? 'stop'
      : 'mic';
  const accessibilityLabel = state === 'speaking'
    ? 'Stop audio playback'
    : state === 'listening'
      ? 'Stop recording'
      : 'Start microphone';

  // Glow animation for processing and connecting
  useEffect(() => {
    cancelAnimation(glowOpacity);
    cancelAnimation(glowScale);

    if (isListening) {
      glowOpacity.value = withRepeat(
        withSequence(
          withTiming(0.9, { duration: 550, easing: Easing.inOut(Easing.ease) }),
          withTiming(0.25, { duration: 550, easing: Easing.inOut(Easing.ease) }),
        ),
        -1,
        true,
      );
      glowScale.value = withRepeat(
        withSequence(
          withTiming(1.25, { duration: 550, easing: Easing.inOut(Easing.ease) }),
          withTiming(1.03, { duration: 550, easing: Easing.inOut(Easing.ease) }),
        ),
        -1,
        true,
      );
    } else if (isProcessing) {
      // Steady pulsing glow when processing
      glowOpacity.value = withRepeat(
        withSequence(
          withTiming(0.8, { duration: 800, easing: Easing.inOut(Easing.ease) }),
          withTiming(0.3, { duration: 800, easing: Easing.inOut(Easing.ease) }),
        ),
        -1,
        true,
      );
      glowScale.value = withRepeat(
        withSequence(
          withTiming(1.15, { duration: 800, easing: Easing.inOut(Easing.ease) }),
          withTiming(1.0, { duration: 800, easing: Easing.inOut(Easing.ease) }),
        ),
        -1,
        true,
      );
    } else if (connecting) {
      // Slow glow when connecting
      glowOpacity.value = withRepeat(
        withSequence(
          withTiming(0.6, { duration: 1200, easing: Easing.inOut(Easing.ease) }),
          withTiming(0.15, { duration: 1200, easing: Easing.inOut(Easing.ease) }),
        ),
        -1,
        true,
      );
      glowScale.value = withTiming(1.05, { duration: 500 });
    } else {
      glowOpacity.value = withTiming(0, { duration: 300 });
      glowScale.value = withTiming(1, { duration: 300 });
    }
  }, [isListening, isProcessing, connecting]);

  // Orb scale animation
  useEffect(() => {
    cancelAnimation(orbScale);

    if (state === 'listening') {
      // Slight scale up when listening
      orbScale.value = withSpring(1.05, animation.spring);
    } else {
      orbScale.value = withSpring(1, animation.spring);
    }
  }, [state]);

  const orbStyle = useAnimatedStyle(() => ({
    transform: [{ scale: orbScale.value }],
  }));

  const glowStyle = useAnimatedStyle(() => ({
    opacity: glowOpacity.value,
    transform: [{ scale: glowScale.value }],
  }));

  // Colors
  const orbColor = disabled
    ? colors.textMuted
    : state === 'listening'
      ? colors.voiceListening
      : isProcessing
        ? colors.voiceThinking
        : colors.primary;

  const glowColor = isListening
    ? colors.voiceListening
    : isProcessing
      ? colors.voiceThinking
      : colors.voiceIdle;

  return (
    <View style={styles.container}>
      {/* Transcript above orb */}
      {transcript ? (
        <Text style={styles.transcript} numberOfLines={2}>{transcript}</Text>
      ) : (
        <View style={styles.transcriptSpacer} />
      )}

      {/* Orb */}
      <View style={styles.orbContainer}>
        {/* Glow ring (processing / connecting) */}
        <Animated.View
          style={[
            styles.glow,
            glowStyle,
            { borderColor: glowColor, shadowColor: glowColor },
          ]}
        />

        <Pressable
          onPress={onTap}
          disabled={connecting || busy}
          hitSlop={16}
          accessibilityRole="button"
          accessibilityLabel={accessibilityLabel}
        >
          <Animated.View
            style={[
              styles.orb,
              orbStyle,
              {
                backgroundColor: orbColor,
                shadowColor: orbColor,
                shadowOpacity: disabled ? 0.15 : 0.4,
                shadowRadius: disabled ? 8 : 16,
              },
            ]}
          >
            <Ionicons
              name={iconName}
              size={36}
              color={disabled ? '#999' : '#FFF'}
            />
          </Animated.View>
        </Pressable>
      </View>

      {/* Hint label */}
      {statusLabel ? (
        <Text style={styles.hintLabel} numberOfLines={3}>{statusLabel}</Text>
      ) : state === 'speaking' ? (
        <Text style={styles.hintLabel}>Playing audio. Tap to stop.</Text>
      ) : state === 'idle' && !connecting && !disabled ? (
        <Text style={styles.hintLabel}>Tap to speak</Text>
      ) : state === 'listening' ? (
        <Text style={[styles.hintLabel, styles.listeningLabel]}>Listening. Tap to send.</Text>
      ) : connecting ? (
        <Text style={styles.hintLabel}>Connecting...</Text>
      ) : disabled && !connecting ? (
        <Text style={styles.hintLabel}>Tap to reconnect</Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    gap: spacing.md,
  },
  transcript: {
    fontSize: fontSize.lg,
    color: colors.text,
    textAlign: 'center',
    paddingHorizontal: spacing.xl,
    minHeight: 48,
  },
  transcriptSpacer: {
    minHeight: 48,
  },
  orbContainer: {
    width: GLOW_SIZE + 20,
    height: GLOW_SIZE + 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  glow: {
    position: 'absolute',
    width: GLOW_SIZE,
    height: GLOW_SIZE,
    borderRadius: GLOW_SIZE / 2,
    borderWidth: 3,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.6,
    shadowRadius: 12,
  },
  orb: {
    width: ORB_SIZE,
    height: ORB_SIZE,
    borderRadius: ORB_SIZE / 2,
    alignItems: 'center',
    justifyContent: 'center',
    shadowOffset: { width: 0, height: 0 },
    elevation: 8,
  },
  hintLabel: {
    fontSize: fontSize.sm,
    color: colors.textMuted,
    marginTop: -spacing.xs,
    maxWidth: 340,
    textAlign: 'center',
    lineHeight: 20,
  },
  listeningLabel: {
    color: colors.voiceListening,
    fontWeight: '600',
  },
});
