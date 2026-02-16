import React, { useEffect } from 'react';
import { View, StyleSheet } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  withDelay,
  withRepeat,
  withSequence,
} from 'react-native-reanimated';
import { colors, spacing } from '@/constants/theme';

const DOT_SIZE = 8;
const DOT_GAP = 6;
const STAGGER = 200;
const CYCLE = 600;

function Dot({ index }: { index: number }) {
  const opacity = useSharedValue(0.3);

  useEffect(() => {
    opacity.value = withDelay(
      index * STAGGER,
      withRepeat(
        withSequence(
          withTiming(1, { duration: CYCLE / 2 }),
          withTiming(0.3, { duration: CYCLE / 2 }),
        ),
        -1,
      ),
    );
  }, []);

  const style = useAnimatedStyle(() => ({
    opacity: opacity.value,
  }));

  return <Animated.View style={[styles.dot, style]} />;
}

export function TypingIndicator() {
  return (
    <View style={styles.container}>
      <View style={styles.dots}>
        <Dot index={0} />
        <Dot index={1} />
        <Dot index={2} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignSelf: 'flex-start',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    marginLeft: spacing.md,
    marginVertical: spacing.xs,
  },
  dots: {
    flexDirection: 'row',
    gap: DOT_GAP,
    alignItems: 'center',
  },
  dot: {
    width: DOT_SIZE,
    height: DOT_SIZE,
    borderRadius: DOT_SIZE / 2,
    backgroundColor: colors.typingDot,
  },
});
