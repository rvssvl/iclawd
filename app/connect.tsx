import { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  StyleSheet,
  Pressable,
  Alert,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing, fontSize, borderRadius } from '@/constants/theme';
import { saveGatewayConfig } from '@/services/SecureStorage';
import { GatewayClient } from '@/services/GatewayClient';
import { donateSiriShortcut } from '@/services/SiriService';
import { categorizeError, getGatewayUrlType, track } from '@/services/AnalyticsService';

export default function ConnectScreen() {
  const router = useRouter();
  const [url, setUrl] = useState('');
  const [token, setToken] = useState('');
  const [connecting, setConnecting] = useState(false);

  async function handleConnect() {
    const trimmedUrl = url.trim();
    const trimmedToken = token.trim();

    if (!trimmedUrl) {
      Alert.alert('Missing URL', 'Enter your OpenClaw gateway URL.');
      return;
    }
    if (!trimmedToken) {
      Alert.alert('Missing Token', 'Enter your gateway authentication token.');
      return;
    }

    const wsUrl = normalizeGatewayUrl(trimmedUrl);

    if (Platform.OS !== 'web' && isLocalhostUrl(wsUrl)) {
      track('connect_failed', {
        screen: 'connect',
        url_type: getGatewayUrlType(wsUrl),
        error_category: 'network',
      });
      Alert.alert(
        'Use a reachable gateway URL',
        '127.0.0.1 and localhost point to this phone, not your OpenClaw computer. Use your computer LAN IP, Tailscale IP, or PrimeClaws URL instead, such as ws://100.x.x.x:18789.',
      );
      return;
    }

    setConnecting(true);
    track('connect_attempted', {
      screen: 'connect',
      url_type: getGatewayUrlType(wsUrl),
    });
    try {
      // Validate the authenticated OpenClaw handshake before saving.
      const testResult = await testConnection(wsUrl, trimmedToken);
      if (!testResult.ok) {
        track('connect_failed', {
          screen: 'connect',
          url_type: getGatewayUrlType(wsUrl),
          error_category: categorizeError(testResult.error),
        });
        Alert.alert('Connection Failed', testResult.error || 'Could not reach the gateway.');
        setConnecting(false);
        return;
      }

      // Save config
      await saveGatewayConfig({
        url: wsUrl,
        token: trimmedToken,
        name: 'My Gateway',
      });

      track('connect_succeeded', {
        screen: 'connect',
        url_type: getGatewayUrlType(wsUrl),
      });

      // Donate Siri shortcut on first successful connection
      donateSiriShortcut().catch(() => {});

      // Navigate to voice chat (primary interface)
      router.replace('/voice');
    } catch (e) {
      track('connect_failed', {
        screen: 'connect',
        url_type: getGatewayUrlType(wsUrl),
        error_category: categorizeError(e),
      });
      Alert.alert('Error', 'Failed to connect. Check your URL and try again.');
      setConnecting(false);
    }
  }

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        {/* Instructions */}
        <View style={styles.infoCard}>
          <Ionicons name="information-circle" size={20} color={colors.info} />
          <Text style={styles.infoText}>
            Use a URL your phone can reach, such as a PrimeClaws URL, Tailscale IP, or LAN IP.
            127.0.0.1 only works on the device running OpenClaw.
          </Text>
        </View>

        {/* URL Input */}
        <Text style={styles.label}>Gateway URL</Text>
        <TextInput
          style={styles.input}
          value={url}
          onChangeText={setUrl}
          placeholder="100.x.x.x:18789 or gateway.example.com"
          placeholderTextColor={colors.textMuted}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
        />

        {/* Token Input */}
        <Text style={styles.label}>Auth Token</Text>
        <TextInput
          style={styles.input}
          value={token}
          onChangeText={setToken}
          placeholder="Your gateway token"
          placeholderTextColor={colors.textMuted}
          autoCapitalize="none"
          autoCorrect={false}
          secureTextEntry
        />

        {/* Connect Button */}
        <Pressable
          style={[styles.connectButton, connecting && styles.connectButtonDisabled]}
          onPress={handleConnect}
          disabled={connecting}
        >
          {connecting ? (
            <ActivityIndicator color={colors.text} />
          ) : (
            <>
              <Ionicons name="flash" size={20} color={colors.text} />
              <Text style={styles.connectButtonText}>Connect</Text>
            </>
          )}
        </Pressable>

        {/* QR code scan - placeholder for later */}
        <Pressable style={styles.qrButton}>
          <Ionicons name="qr-code" size={20} color={colors.primaryLight} />
          <Text style={styles.qrButtonText}>Scan QR Code</Text>
        </Pressable>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function normalizeGatewayUrl(rawUrl: string): string {
  const url = rawUrl.trim();
  if (url.startsWith('http://')) {
    return url.replace('http://', 'ws://');
  }
  if (url.startsWith('https://')) {
    return url.replace('https://', 'wss://');
  }
  if (url.startsWith('ws://') || url.startsWith('wss://')) {
    return url;
  }

  return `${shouldDefaultToPlainWebSocket(url) ? 'ws' : 'wss'}://${url}`;
}

function shouldDefaultToPlainWebSocket(urlWithoutScheme: string): boolean {
  const host = urlWithoutScheme.split('/')[0].split(':')[0].toLowerCase();
  return isLocalhostHost(host)
    || isIPv4Host(host)
    || host.endsWith('.local')
    || !host.includes('.');
}

function isLocalhostUrl(wsUrl: string): boolean {
  try {
    return isLocalhostHost(new URL(wsUrl).hostname.toLowerCase());
  } catch {
    return false;
  }
}

function isLocalhostHost(host: string): boolean {
  return host === 'localhost'
    || host === '127.0.0.1'
    || host === '0.0.0.0'
    || host === '::1'
    || host === '[::1]';
}

function isIPv4Host(host: string): boolean {
  return /^\d{1,3}(?:\.\d{1,3}){3}$/.test(host);
}

async function testConnection(wsUrl: string, token: string): Promise<{ ok: boolean; error?: string }> {
  const client = new GatewayClient({
    url: wsUrl,
    token,
    name: 'Connection Test',
  });

  try {
    await client.connect();
    return { ok: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Could not connect to the gateway.';
    return {
      ok: false,
      error: message === 'WebSocket error'
        ? 'Could not reach the gateway. Check your URL.'
        : message,
    };
  } finally {
    client.disconnect();
  }
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    padding: spacing.lg,
    gap: spacing.md,
  },
  infoCard: {
    flexDirection: 'row',
    gap: spacing.sm,
    backgroundColor: colors.surface,
    borderRadius: borderRadius.md,
    padding: spacing.md,
    marginBottom: spacing.sm,
  },
  infoText: {
    flex: 1,
    fontSize: fontSize.sm,
    color: colors.textSecondary,
    lineHeight: 20,
  },
  label: {
    fontSize: fontSize.sm,
    fontWeight: '600',
    color: colors.textSecondary,
    marginBottom: spacing.xs,
  },
  input: {
    backgroundColor: colors.surface,
    borderRadius: borderRadius.md,
    padding: spacing.md,
    fontSize: fontSize.md,
    color: colors.text,
    borderWidth: 1,
    borderColor: colors.border,
  },
  connectButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    backgroundColor: colors.primary,
    borderRadius: borderRadius.md,
    padding: spacing.md,
    marginTop: spacing.md,
  },
  connectButtonDisabled: {
    opacity: 0.6,
  },
  connectButtonText: {
    fontSize: fontSize.lg,
    fontWeight: '600',
    color: colors.text,
  },
  qrButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    padding: spacing.md,
  },
  qrButtonText: {
    fontSize: fontSize.md,
    color: colors.primaryLight,
  },
});
