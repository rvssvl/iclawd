import { useEffect, useState } from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing, fontSize, borderRadius } from '@/constants/theme';
import { getGatewayConfig } from '@/services/SecureStorage';

export default function OnboardingScreen() {
  const router = useRouter();
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    checkExistingConnection();
  }, []);

  async function checkExistingConnection() {
    try {
      const config = await getGatewayConfig();
      if (config) {
        // Already connected before — go straight to voice chat
        router.replace('/voice');
        return;
      }
    } catch {
      // No config — show onboarding
    }
    setChecking(false);
  }

  if (checking) {
    return (
      <View style={styles.container}>
        <Text style={styles.loadingText}>Loading...</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* Logo / Title */}
      <View style={styles.hero}>
        <View style={styles.logoContainer}>
          <Text style={styles.logoEmoji}>🦀</Text>
        </View>
        <Text style={styles.title}>iClawd</Text>
        <Text style={styles.subtitle}>
          Voice-first companion for your{'\n'}OpenClaw AI agent
        </Text>
      </View>

      {/* Action buttons */}
      <View style={styles.actions}>
        <Pressable
          style={styles.primaryButton}
          onPress={() => router.push('/connect')}
        >
          <Ionicons name="link" size={24} color={colors.text} />
          <View style={styles.buttonTextContainer}>
            <Text style={styles.buttonTitle}>I have an agent</Text>
            <Text style={styles.buttonDesc}>Connect to your OpenClaw gateway</Text>
          </View>
          <Ionicons name="chevron-forward" size={20} color={colors.textMuted} />
        </Pressable>

        <Pressable
          style={styles.secondaryButton}
          onPress={() => router.push('/setup-guide')}
        >
          <Ionicons name="rocket" size={24} color={colors.primaryLight} />
          <View style={styles.buttonTextContainer}>
            <Text style={styles.buttonTitle}>I need an agent</Text>
            <Text style={styles.buttonDesc}>Set up OpenClaw in 5 minutes</Text>
          </View>
          <Ionicons name="chevron-forward" size={20} color={colors.textMuted} />
        </Pressable>
      </View>

      {/* Footer */}
      <Text style={styles.footer}>
        Open source & free forever
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
    paddingHorizontal: spacing.lg,
    justifyContent: 'center',
  },
  loadingText: {
    color: colors.textSecondary,
    fontSize: fontSize.md,
    textAlign: 'center',
  },
  hero: {
    alignItems: 'center',
    marginBottom: spacing.xxl,
  },
  logoContainer: {
    width: 120,
    height: 120,
    borderRadius: borderRadius.xl,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.lg,
  },
  logoEmoji: {
    fontSize: 64,
    lineHeight: 80,
  },
  title: {
    fontSize: fontSize.hero,
    fontWeight: '700',
    color: colors.text,
    marginBottom: spacing.sm,
  },
  subtitle: {
    fontSize: fontSize.md,
    color: colors.textSecondary,
    textAlign: 'center',
    lineHeight: 24,
  },
  actions: {
    gap: spacing.md,
  },
  primaryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: borderRadius.lg,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.primary,
    gap: spacing.md,
  },
  secondaryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: borderRadius.lg,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
    gap: spacing.md,
  },
  buttonTextContainer: {
    flex: 1,
  },
  buttonTitle: {
    fontSize: fontSize.lg,
    fontWeight: '600',
    color: colors.text,
  },
  buttonDesc: {
    fontSize: fontSize.sm,
    color: colors.textSecondary,
    marginTop: 2,
  },
  footer: {
    fontSize: fontSize.xs,
    color: colors.textMuted,
    textAlign: 'center',
    marginTop: spacing.xxl,
  },
});
