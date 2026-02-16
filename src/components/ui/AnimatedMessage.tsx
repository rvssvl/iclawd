import React, { useEffect } from 'react';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  withDelay,
  Easing,
} from 'react-native-reanimated';
import { animation } from '@/constants/theme';

interface Props {
  children: React.ReactNode;
  delay?: number;
  direction?: 'left' | 'right';
}

export function AnimatedMessage({ children, delay = 0, direction = 'left' }: Props) {
  const opacity = useSharedValue(0);
  const translateX = useSharedValue(direction === 'right' ? 12 : -12);
  const translateY = useSharedValue(6);

  useEffect(() => {
    const config = { duration: animation.slow, easing: Easing.out(Easing.ease) };
    opacity.value = withDelay(delay, withTiming(1, config));
    translateX.value = withDelay(delay, withTiming(0, config));
    translateY.value = withDelay(delay, withTiming(0, config));
  }, []);

  const animatedStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [
      { translateX: translateX.value },
      { translateY: translateY.value },
    ],
  }));

  return <Animated.View style={animatedStyle}>{children}</Animated.View>;
}
