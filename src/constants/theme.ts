export const colors = {
  // Dark theme - primary palette
  background: '#0A0A0A',
  surface: '#141414',
  surfaceLight: '#1E1E1E',
  surfaceElevated: '#1A1A1A',
  surfaceBubble: '#2A2A2A',
  border: '#2A2A2A',

  // Brand
  primary: '#6C5CE7',
  primaryLight: '#A29BFE',
  primaryDark: '#4834D4',

  // Text
  text: '#FFFFFF',
  textSecondary: '#A0A0A0',
  textMuted: '#666666',

  // Status
  success: '#00D68F',
  warning: '#FFAA00',
  error: '#FF4757',
  info: '#339AF0',

  // Voice states
  voiceListening: '#6C5CE7',
  voiceThinking: '#FFAA00',
  voiceSpeaking: '#00D68F',
  voiceIdle: '#666666',

  // UI
  typingDot: '#888888',
} as const;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
  xxl: 48,
} as const;

export const fontSize = {
  xs: 12,
  sm: 14,
  md: 16,
  lg: 18,
  xl: 24,
  xxl: 32,
  hero: 40,
} as const;

export const fontWeight = {
  regular: '400' as const,
  medium: '500' as const,
  semibold: '600' as const,
  bold: '700' as const,
};

export const lineHeight = {
  tight: 20,
  normal: 24,
  relaxed: 28,
};

export const borderRadius = {
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  full: 999,
} as const;

export const animation = {
  fast: 150,
  normal: 250,
  slow: 400,
  breathing: 2000,
  spring: { damping: 15, stiffness: 150 },
} as const;
