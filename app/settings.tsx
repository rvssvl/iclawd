import { useState, useEffect } from 'react';
import { View, Text, StyleSheet, Pressable, Alert, ScrollView, TextInput, Platform, Switch, Linking } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as SecureStore from 'expo-secure-store';
import { colors, spacing, fontSize, borderRadius } from '@/constants/theme';
import { getGatewayConfig, deleteGatewayConfig } from '@/services/SecureStorage';
import { addSiriShortcut } from '@/services/SiriService';
import type { GatewayConfig } from '@/types/gateway';

const ELEVENLABS_KEY = 'iclawd_elevenlabs_key';
const KEY_AUTO_PRONOUNCE = 'iclawd_auto_pronounce';
const KEY_NOTIFICATIONS = 'iclawd_notifications';

async function getElevenLabsKey(): Promise<string | null> {
  return SecureStore.getItemAsync(ELEVENLABS_KEY);
}

async function saveElevenLabsKey(key: string): Promise<void> {
  if (key.trim()) {
    await SecureStore.setItemAsync(ELEVENLABS_KEY, key.trim());
  } else {
    await SecureStore.deleteItemAsync(ELEVENLABS_KEY);
  }
}

export default function SettingsScreen() {
  const router = useRouter();
  const [config, setConfig] = useState<GatewayConfig | null>(null);
  const [elevenLabsKey, setElevenLabsKey] = useState('');
  const [editingKey, setEditingKey] = useState(false);
  const [keyInput, setKeyInput] = useState('');
  const [autoPronounce, setAutoPronounce] = useState(true);
  const [notifications, setNotifications] = useState(true);

  useEffect(() => {
    getGatewayConfig().then(setConfig);
    getElevenLabsKey().then((k) => { if (k) setElevenLabsKey(k); });
    SecureStore.getItemAsync(KEY_AUTO_PRONOUNCE).then((v) => setAutoPronounce(v !== 'false'));
    SecureStore.getItemAsync(KEY_NOTIFICATIONS).then((v) => setNotifications(v !== 'false'));
  }, []);

  function handleDisconnect() {
    Alert.alert(
      'Disconnect Gateway',
      'This will remove your gateway credentials. You can reconnect anytime.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Disconnect',
          style: 'destructive',
          onPress: async () => {
            await deleteGatewayConfig();
            router.replace('/');
          },
        },
      ],
    );
  }

  function handleEditKey() {
    setKeyInput(elevenLabsKey);
    setEditingKey(true);
  }

  async function handleSaveKey() {
    await saveElevenLabsKey(keyInput);
    setElevenLabsKey(keyInput.trim());
    setEditingKey(false);
  }

  function handleCancelKey() {
    setEditingKey(false);
    setKeyInput('');
  }

  function handleClearKey() {
    Alert.alert('Remove API Key', 'This will remove your ElevenLabs API key.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: async () => {
          await saveElevenLabsKey('');
          setElevenLabsKey('');
        },
      },
    ]);
  }

  async function toggleAutoPronounce(value: boolean) {
    setAutoPronounce(value);
    await SecureStore.setItemAsync(KEY_AUTO_PRONOUNCE, String(value));
  }

  async function toggleNotifications(value: boolean) {
    setNotifications(value);
    await SecureStore.setItemAsync(KEY_NOTIFICATIONS, String(value));
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      {/* Gateway Section */}
      <Text style={styles.sectionTitle}>Gateway</Text>
      <View style={styles.card}>
        {config ? (
          <>
            <View style={styles.row}>
              <Text style={styles.rowLabel}>URL</Text>
              <Text style={styles.rowValue} numberOfLines={1}>{config.url}</Text>
            </View>
            <View style={styles.divider} />
            <View style={styles.row}>
              <Text style={styles.rowLabel}>Name</Text>
              <Text style={styles.rowValue}>{config.name || 'My Gateway'}</Text>
            </View>
            <View style={styles.divider} />
            <Pressable style={styles.row} onPress={handleDisconnect}>
              <Text style={[styles.rowLabel, { color: colors.error }]}>Disconnect</Text>
              <Ionicons name="log-out-outline" size={18} color={colors.error} />
            </Pressable>
          </>
        ) : (
          <Pressable style={styles.row} onPress={() => router.push('/connect')}>
            <Text style={styles.rowLabel}>Connect to Gateway</Text>
            <Ionicons name="add-circle-outline" size={18} color={colors.primary} />
          </Pressable>
        )}
      </View>

      {/* Voice Section */}
      <Text style={styles.sectionTitle}>Voice</Text>
      <View style={styles.card}>
        <View style={styles.row}>
          <Text style={styles.rowLabel}>Text-to-Speech</Text>
          <Text style={styles.rowValue}>{elevenLabsKey ? 'ElevenLabs' : 'System Voice'}</Text>
        </View>
        <View style={styles.divider} />
        {editingKey ? (
          <View style={styles.keyEditContainer}>
            <TextInput
              style={styles.keyInput}
              value={keyInput}
              onChangeText={setKeyInput}
              placeholder="sk-..."
              placeholderTextColor={colors.textMuted}
              autoCapitalize="none"
              autoCorrect={false}
              autoFocus
              secureTextEntry
            />
            <View style={styles.keyActions}>
              <Pressable style={styles.keyButton} onPress={handleCancelKey}>
                <Text style={styles.keyButtonCancel}>Cancel</Text>
              </Pressable>
              <Pressable style={[styles.keyButton, styles.keySaveButton]} onPress={handleSaveKey}>
                <Text style={styles.keyButtonSave}>Save</Text>
              </Pressable>
            </View>
          </View>
        ) : (
          <Pressable style={styles.row} onPress={elevenLabsKey ? handleClearKey : handleEditKey}>
            <Text style={styles.rowLabel}>ElevenLabs API Key</Text>
            {elevenLabsKey ? (
              <View style={styles.keyConfigured}>
                <Text style={styles.rowValue}>
                  {'•'.repeat(4)}{elevenLabsKey.slice(-4)}
                </Text>
                <Pressable onPress={handleEditKey} hitSlop={8}>
                  <Ionicons name="pencil" size={14} color={colors.textSecondary} />
                </Pressable>
              </View>
            ) : (
              <Text style={[styles.rowValue, { color: colors.primary }]}>Configure</Text>
            )}
          </Pressable>
        )}
      </View>

      {/* Siri Section (iOS only) */}
      {Platform.OS === 'ios' && (
        <>
          <Text style={styles.sectionTitle}>Siri</Text>
          <View style={styles.card}>
            <Pressable style={styles.row} onPress={() => addSiriShortcut()}>
              <Text style={styles.rowLabel}>Add to Siri</Text>
              <Ionicons name="mic-outline" size={18} color={colors.primary} />
            </Pressable>
            <View style={styles.divider} />
            <View style={styles.row}>
              <Text style={[styles.rowLabel, { fontSize: fontSize.sm, color: colors.textSecondary }]}>
                Say "Hey Siri, Ask Claw" to launch voice mode
              </Text>
            </View>
          </View>
        </>
      )}

      {/* Responses Section */}
      <Text style={styles.sectionTitle}>Responses</Text>
      <View style={styles.card}>
        <View style={styles.row}>
          <Text style={styles.rowLabel}>Auto-pronounce</Text>
          <Switch
            value={autoPronounce}
            onValueChange={toggleAutoPronounce}
            trackColor={{ false: colors.border, true: colors.primary }}
          />
        </View>
        <View style={styles.divider} />
        <View style={styles.row}>
          <Text style={styles.rowLabel}>Notifications</Text>
          <Switch
            value={notifications}
            onValueChange={toggleNotifications}
            trackColor={{ false: colors.border, true: colors.primary }}
          />
        </View>
      </View>

      {/* About Section */}
      <Text style={styles.sectionTitle}>About</Text>
      <View style={styles.card}>
        <View style={styles.row}>
          <Text style={styles.rowLabel}>Version</Text>
          <Text style={styles.rowValue}>2.0.1</Text>
        </View>
        <View style={styles.divider} />
        <View style={styles.row}>
          <Text style={styles.rowLabel}>License</Text>
          <Text style={styles.rowValue}>MIT</Text>
        </View>
        <View style={styles.divider} />
        <Pressable style={styles.row} onPress={() => Linking.openURL('https://github.com/rvssvl/iclawd')}>
          <Text style={styles.rowLabel}>GitHub</Text>
          <Ionicons name="logo-github" size={18} color={colors.textSecondary} />
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
    gap: spacing.sm,
  },
  sectionTitle: {
    fontSize: fontSize.sm,
    fontWeight: '600',
    color: colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginTop: spacing.md,
    marginBottom: spacing.xs,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: borderRadius.lg,
    overflow: 'hidden',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    minHeight: 48,
  },
  rowLabel: {
    fontSize: fontSize.md,
    color: colors.text,
  },
  rowValue: {
    fontSize: fontSize.sm,
    color: colors.textSecondary,
    maxWidth: '60%',
    textAlign: 'right',
  },
  divider: {
    height: 1,
    backgroundColor: colors.border,
    marginLeft: spacing.md,
  },
  keyEditContainer: {
    padding: spacing.md,
    gap: spacing.sm,
  },
  keyInput: {
    backgroundColor: colors.background,
    color: colors.text,
    fontSize: fontSize.md,
    borderRadius: borderRadius.md,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  keyActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: spacing.sm,
  },
  keyButton: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: borderRadius.md,
  },
  keySaveButton: {
    backgroundColor: colors.primary,
  },
  keyButtonCancel: {
    color: colors.textSecondary,
    fontSize: fontSize.sm,
    fontWeight: '500',
  },
  keyButtonSave: {
    color: '#FFFFFF',
    fontSize: fontSize.sm,
    fontWeight: '600',
  },
  keyConfigured: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
});
