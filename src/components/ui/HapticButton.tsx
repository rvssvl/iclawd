import React, { useCallback } from 'react';
import { Pressable, type PressableProps } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
} from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import { animation } from '@/constants/theme';

interface Props extends PressableProps {
  hapticType?: 'light' | 'medium' | 'heavy';
  scaleOnPress?: boolean;
}

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

export function HapticButton({
  hapticType = 'light',
  scaleOnPress = true,
  onPressIn,
  onPressOut,
  style,
  ...rest
}: Props) {
  const scale = useSharedValue(1);

  const handlePressIn = useCallback(
    (e: any) => {
      const impact =
        hapticType === 'heavy'
          ? Haptics.ImpactFeedbackStyle.Heavy
          : hapticType === 'medium'
            ? Haptics.ImpactFeedbackStyle.Medium
            : Haptics.ImpactFeedbackStyle.Light;
      Haptics.impactAsync(impact);
      if (scaleOnPress) {
        scale.value = withSpring(0.97, animation.spring);
      }
      onPressIn?.(e);
    },
    [hapticType, scaleOnPress, onPressIn],
  );

  const handlePressOut = useCallback(
    (e: any) => {
      if (scaleOnPress) {
        scale.value = withSpring(1, animation.spring);
      }
      onPressOut?.(e);
    },
    [scaleOnPress, onPressOut],
  );

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  return (
    <AnimatedPressable
      onPressIn={handlePressIn}
      onPressOut={handlePressOut}
      style={[animatedStyle, style]}
      {...rest}
    />
  );
}
