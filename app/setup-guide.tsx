import { View, Text, StyleSheet, Pressable, Linking, ScrollView } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing, fontSize, borderRadius } from '@/constants/theme';

const RAILWAY_TEMPLATE_URL = 'https://railway.app/template/openclaw';

const steps = [
  {
    icon: 'cloud-outline' as const,
    title: 'Deploy OpenClaw on Railway',
    desc: 'One-click deploy to Railway (~$5/mo). No server setup required.',
    action: 'Open Railway Template',
    url: RAILWAY_TEMPLATE_URL,
  },
  {
    icon: 'key-outline' as const,
    title: 'Copy your gateway URL & token',
    desc: 'After deploy, find your gateway URL and auth token in the Railway dashboard.',
  },
  {
    icon: 'link-outline' as const,
    title: 'Connect in iClawd',
    desc: 'Paste your gateway URL and token to start talking to your agent.',
    action: 'I have my credentials',
    route: '/connect',
  },
];

export default function SetupGuideScreen() {
  const router = useRouter();

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.heading}>Set up your AI agent</Text>
      <Text style={styles.subheading}>
        Deploy OpenClaw in 5 minutes. You'll have your own private AI agent running on Railway.
      </Text>

      {steps.map((step, i) => (
        <View key={i} style={styles.stepCard}>
          <View style={styles.stepHeader}>
            <View style={styles.stepNumber}>
              <Text style={styles.stepNumberText}>{i + 1}</Text>
            </View>
            <Ionicons name={step.icon} size={24} color={colors.primaryLight} />
          </View>
          <Text style={styles.stepTitle}>{step.title}</Text>
          <Text style={styles.stepDesc}>{step.desc}</Text>
          {step.action && (
            <Pressable
              style={styles.stepAction}
              onPress={() => {
                if (step.url) Linking.openURL(step.url);
                else if (step.route) router.push(step.route as '/connect');
              }}
            >
              <Text style={styles.stepActionText}>{step.action}</Text>
              <Ionicons name="arrow-forward" size={16} color={colors.primary} />
            </Pressable>
          )}
        </View>
      ))}

      <View style={styles.altSection}>
        <Text style={styles.altTitle}>Already have a VPS?</Text>
        <Text style={styles.altDesc}>
          Install OpenClaw on any server and point iClawd to it. Works with Tailscale, Cloudflare Tunnel, or direct IP.
        </Text>
        <Pressable onPress={() => Linking.openURL('https://github.com/openclaw/openclaw')}>
          <Text style={styles.altLink}>View OpenClaw on GitHub</Text>
        </Pressable>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    padding: spacing.lg,
    gap: spacing.lg,
  },
  heading: {
    fontSize: fontSize.xl,
    fontWeight: '700',
    color: colors.text,
  },
  subheading: {
    fontSize: fontSize.md,
    color: colors.textSecondary,
    lineHeight: 22,
  },
  stepCard: {
    backgroundColor: colors.surface,
    borderRadius: borderRadius.lg,
    padding: spacing.lg,
    gap: spacing.sm,
  },
  stepHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  stepNumber: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: colors.primaryDark,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepNumberText: {
    color: colors.text,
    fontSize: fontSize.sm,
    fontWeight: '700',
  },
  stepTitle: {
    fontSize: fontSize.lg,
    fontWeight: '600',
    color: colors.text,
    marginTop: spacing.xs,
  },
  stepDesc: {
    fontSize: fontSize.sm,
    color: colors.textSecondary,
    lineHeight: 20,
  },
  stepAction: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    marginTop: spacing.sm,
  },
  stepActionText: {
    fontSize: fontSize.md,
    color: colors.primary,
    fontWeight: '600',
  },
  altSection: {
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingTop: spacing.lg,
    gap: spacing.sm,
  },
  altTitle: {
    fontSize: fontSize.md,
    fontWeight: '600',
    color: colors.text,
  },
  altDesc: {
    fontSize: fontSize.sm,
    color: colors.textSecondary,
    lineHeight: 20,
  },
  altLink: {
    fontSize: fontSize.sm,
    color: colors.primaryLight,
    fontWeight: '500',
  },
});
