import React, { useState } from 'react';
import { TextInput, View, Text, StyleSheet, type TextInputProps } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  interpolateColor,
} from 'react-native-reanimated';
import { colors, spacing, fontSize, borderRadius, animation } from '@/constants/theme';

interface Props extends TextInputProps {
  label?: string;
}

export function ThemedInput({ label, style, ...rest }: Props) {
  const focus = useSharedValue(0);
  const [isFocused, setIsFocused] = useState(false);

  const borderStyle = useAnimatedStyle(() => ({
    borderColor: interpolateColor(
      focus.value,
      [0, 1],
      [colors.border, colors.primaryLight],
    ),
  }));

  return (
    <View>
      {label && <Text style={styles.label}>{label}</Text>}
      <Animated.View style={[styles.inputContainer, borderStyle]}>
        <TextInput
          placeholderTextColor={colors.textMuted}
          style={[styles.input, style]}
          onFocus={(e) => {
            setIsFocused(true);
            focus.value = withTiming(1, { duration: animation.normal });
            rest.onFocus?.(e);
          }}
          onBlur={(e) => {
            setIsFocused(false);
            focus.value = withTiming(0, { duration: animation.normal });
            rest.onBlur?.(e);
          }}
          {...rest}
        />
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  label: {
    color: colors.textSecondary,
    fontSize: fontSize.sm,
    marginBottom: spacing.xs,
    fontWeight: '500',
  },
  inputContainer: {
    borderWidth: 1,
    borderRadius: borderRadius.md,
    backgroundColor: colors.surface,
  },
  input: {
    color: colors.text,
    fontSize: fontSize.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
  },
});
