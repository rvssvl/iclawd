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
import { donateSiriShortcut } from '@/services/SiriService';

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

    // Normalize URL: ensure ws:// or wss://
    let wsUrl = trimmedUrl;
    if (wsUrl.startsWith('http://')) {
      wsUrl = wsUrl.replace('http://', 'ws://');
    } else if (wsUrl.startsWith('https://')) {
      wsUrl = wsUrl.replace('https://', 'wss://');
    } else if (!wsUrl.startsWith('ws://') && !wsUrl.startsWith('wss://')) {
      wsUrl = `wss://${wsUrl}`;
    }

    setConnecting(true);
    try {
      // Quick connectivity test — try to open WebSocket
      const testResult = await testConnection(wsUrl);
      if (!testResult.ok) {
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

      // Donate Siri shortcut on first successful connection
      donateSiriShortcut().catch(() => {});

      // Navigate to voice chat (primary interface)
      router.replace('/voice');
    } catch (e) {
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
            Find your gateway URL and token in your OpenClaw dashboard or terminal output.
          </Text>
        </View>

        {/* URL Input */}
        <Text style={styles.label}>Gateway URL</Text>
        <TextInput
          style={styles.input}
          value={url}
          onChangeText={setUrl}
          placeholder="gateway.example.com:18789"
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

async function testConnection(wsUrl: string): Promise<{ ok: boolean; error?: string }> {
  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      resolve({ ok: false, error: 'Connection timed out after 5 seconds.' });
    }, 5000);

    try {
      const ws = new WebSocket(wsUrl);
      ws.onopen = () => {
        clearTimeout(timeout);
        ws.close();
        resolve({ ok: true });
      };
      ws.onerror = () => {
        clearTimeout(timeout);
        resolve({ ok: false, error: 'Could not reach the gateway. Check your URL.' });
      };
    } catch {
      clearTimeout(timeout);
      resolve({ ok: false, error: 'Invalid URL format.' });
    }
  });
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
