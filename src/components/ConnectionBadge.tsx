import { useEffect } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withTiming,
  cancelAnimation,
} from 'react-native-reanimated';
import type { ConnectionState } from '@/types/gateway';
import { colors, spacing, fontSize, borderRadius } from '@/constants/theme';

const stateConfig: Record<ConnectionState, { color: string; label: string }> = {
  connected: { color: colors.success, label: 'Connected' },
  connecting: { color: colors.warning, label: 'Connecting...' },
  reconnecting: { color: colors.warning, label: 'Reconnecting...' },
  disconnected: { color: colors.textMuted, label: 'Disconnected' },
  error: { color: colors.error, label: 'Error' },
};

interface Props {
  state: ConnectionState;
}

export function ConnectionBadge({ state }: Props) {
  const { color, label } = stateConfig[state];
  const dotOpacity = useSharedValue(1);

  useEffect(() => {
    cancelAnimation(dotOpacity);
    if (state === 'connecting' || state === 'reconnecting') {
      dotOpacity.value = withRepeat(
        withTiming(0.3, { duration: 800 }),
        -1,
        true,
      );
    } else {
      dotOpacity.value = withTiming(1, { duration: 200 });
    }
  }, [state]);

  const dotStyle = useAnimatedStyle(() => ({
    opacity: dotOpacity.value,
  }));

  return (
    <View style={styles.container}>
      <Animated.View style={[styles.dot, { backgroundColor: color }, dotStyle]} />
      <Text style={[styles.label, { color }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    backgroundColor: colors.surface,
    borderRadius: borderRadius.full,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  label: {
    fontSize: fontSize.xs,
    fontWeight: '500',
  },
});
