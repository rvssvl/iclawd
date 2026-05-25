import { useState, useEffect } from 'react';
import { View, Text, StyleSheet, Pressable, Alert, ScrollView, TextInput, Platform, Switch, Linking, ActivityIndicator } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as Updates from 'expo-updates';
import * as SecureStore from 'expo-secure-store';
import { colors, spacing, fontSize, borderRadius } from '@/constants/theme';
import { getGatewayConfig, deleteGatewayConfig } from '@/services/SecureStorage';
import { addSiriShortcut } from '@/services/SiriService';
import type { GatewayConfig } from '@/types/gateway';
import {
  DEFAULT_ELEVENLABS_TTS_SIMILARITY,
  DEFAULT_ELEVENLABS_TTS_SPEED,
  DEFAULT_ELEVENLABS_TTS_STABILITY,
  DEFAULT_ELEVENLABS_VOICE_ID,
  ELEVENLABS_KEY,
  ELEVENLABS_TTS_SIMILARITY,
  ELEVENLABS_TTS_SPEED,
  ELEVENLABS_TTS_STABILITY,
  ELEVENLABS_TTS_VOICE_ID,
  getElevenLabsTtsSettings,
  isElevenLabsSttEnabled,
  setElevenLabsSttEnabled,
  saveElevenLabsTtsSetting,
} from '@/services/ElevenLabsConfig';

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
  const [checkingUpdate, setCheckingUpdate] = useState(false);
  const [ttsVoiceId, setTtsVoiceId] = useState(DEFAULT_ELEVENLABS_VOICE_ID);
  const [ttsSpeed, setTtsSpeed] = useState(String(DEFAULT_ELEVENLABS_TTS_SPEED));
  const [ttsStability, setTtsStability] = useState(String(DEFAULT_ELEVENLABS_TTS_STABILITY));
  const [ttsSimilarity, setTtsSimilarity] = useState(String(DEFAULT_ELEVENLABS_TTS_SIMILARITY));
  const [elevenLabsStt, setElevenLabsStt] = useState(false);

  useEffect(() => {
    getGatewayConfig().then(setConfig);
    getElevenLabsKey().then((k) => { if (k) setElevenLabsKey(k); });
    getElevenLabsTtsSettings().then((settings) => {
      setTtsVoiceId(settings.voiceId);
      setTtsSpeed(String(settings.speed));
      setTtsStability(String(settings.stability));
      setTtsSimilarity(String(settings.similarityBoost));
    });
    SecureStore.getItemAsync(KEY_AUTO_PRONOUNCE).then((v) => setAutoPronounce(v !== 'false'));
    SecureStore.getItemAsync(KEY_NOTIFICATIONS).then((v) => setNotifications(v !== 'false'));
    isElevenLabsSttEnabled().then(setElevenLabsStt);
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
    if (!keyInput.trim()) {
      await setElevenLabsSttEnabled(false);
      setElevenLabsStt(false);
    }
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
          await setElevenLabsSttEnabled(false);
          setElevenLabsKey('');
          setElevenLabsStt(false);
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

  async function toggleElevenLabsStt(value: boolean) {
    setElevenLabsStt(value);
    await setElevenLabsSttEnabled(value);
  }

  async function saveTtsSetting(key: string, value: string, setValue: (value: string) => void) {
    await saveElevenLabsTtsSetting(key, value);
    setValue(value.trim());
  }

  async function handleCheckForUpdates() {
    if (__DEV__) {
      Alert.alert('Updates unavailable', 'OTA updates are disabled in development builds.');
      return;
    }

    setCheckingUpdate(true);
    try {
      const update = await Updates.checkForUpdateAsync();
      if (!update.isAvailable) {
        Alert.alert('Up to date', 'You are already running the latest available update.');
        return;
      }

      await Updates.fetchUpdateAsync();
      Alert.alert('Update ready', 'Restart the app now to use the latest update.', [
        { text: 'Later', style: 'cancel' },
        {
          text: 'Restart Now',
          onPress: () => {
            Updates.reloadAsync().catch(() => {});
          },
        },
      ]);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Could not check for updates.';
      Alert.alert('Update check failed', message);
    } finally {
      setCheckingUpdate(false);
    }
  }

  const bundleLabel = Updates.updateId
    ? Updates.updateId.slice(0, 8)
    : Updates.isEmbeddedLaunch
      ? 'Embedded'
      : 'Unavailable';
  const bundleDate = Updates.createdAt
    ? Updates.createdAt.toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
    : null;

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
        <View style={styles.row}>
          <Text style={styles.rowLabel}>Speech-to-Text</Text>
          <Text style={styles.rowValue}>{elevenLabsKey && elevenLabsStt ? 'ElevenLabs' : 'System'}</Text>
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
        {elevenLabsKey ? (
          <>
            <View style={styles.divider} />
            <View style={styles.row}>
              <View>
                <Text style={styles.rowLabel}>ElevenLabs STT</Text>
                <Text style={styles.rowDescription}>Use API transcription for voice and dictation.</Text>
              </View>
              <Switch
                value={elevenLabsStt}
                onValueChange={toggleElevenLabsStt}
                trackColor={{ false: colors.border, true: colors.primary }}
              />
            </View>
            <View style={styles.divider} />
            <View style={styles.settingInputRow}>
              <Text style={styles.rowLabel}>Voice ID</Text>
              <TextInput
                style={styles.inlineInput}
                value={ttsVoiceId}
                onChangeText={setTtsVoiceId}
                onBlur={() => saveTtsSetting(ELEVENLABS_TTS_VOICE_ID, ttsVoiceId, setTtsVoiceId)}
                placeholder={DEFAULT_ELEVENLABS_VOICE_ID}
                placeholderTextColor={colors.textMuted}
                autoCapitalize="none"
                autoCorrect={false}
              />
            </View>
            <View style={styles.divider} />
            <View style={styles.settingInputRow}>
              <Text style={styles.rowLabel}>Speed</Text>
              <TextInput
                style={styles.numberInput}
                value={ttsSpeed}
                onChangeText={setTtsSpeed}
                onBlur={() => saveTtsSetting(ELEVENLABS_TTS_SPEED, ttsSpeed, setTtsSpeed)}
                keyboardType="decimal-pad"
                placeholder="1"
                placeholderTextColor={colors.textMuted}
              />
            </View>
            <View style={styles.divider} />
            <View style={styles.settingInputRow}>
              <Text style={styles.rowLabel}>Stability</Text>
              <TextInput
                style={styles.numberInput}
                value={ttsStability}
                onChangeText={setTtsStability}
                onBlur={() => saveTtsSetting(ELEVENLABS_TTS_STABILITY, ttsStability, setTtsStability)}
                keyboardType="decimal-pad"
                placeholder="0.5"
                placeholderTextColor={colors.textMuted}
              />
            </View>
            <View style={styles.divider} />
            <View style={styles.settingInputRow}>
              <Text style={styles.rowLabel}>Similarity</Text>
              <TextInput
                style={styles.numberInput}
                value={ttsSimilarity}
                onChangeText={setTtsSimilarity}
                onBlur={() => saveTtsSetting(ELEVENLABS_TTS_SIMILARITY, ttsSimilarity, setTtsSimilarity)}
                keyboardType="decimal-pad"
                placeholder="0.75"
                placeholderTextColor={colors.textMuted}
              />
            </View>
          </>
        ) : null}
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
                Say "Hey Siri, Clawd Voice" to launch voice mode
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
          <Text style={styles.rowValue}>2.0.2</Text>
        </View>
        <View style={styles.divider} />
        <View style={styles.row}>
          <Text style={styles.rowLabel}>Bundle</Text>
          <Text style={styles.rowValue} numberOfLines={1}>
            {bundleDate ? `${bundleLabel} · ${bundleDate}` : bundleLabel}
          </Text>
        </View>
        <View style={styles.divider} />
        <Pressable style={styles.row} onPress={handleCheckForUpdates} disabled={checkingUpdate}>
          <Text style={styles.rowLabel}>Check for Updates</Text>
          {checkingUpdate ? (
            <ActivityIndicator size="small" color={colors.primaryLight} />
          ) : (
            <Ionicons name="cloud-download-outline" size={18} color={colors.primary} />
          )}
        </Pressable>
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
  rowDescription: {
    fontSize: fontSize.xs,
    color: colors.textMuted,
    marginTop: 2,
    maxWidth: 220,
  },
  settingInputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    minHeight: 48,
    gap: spacing.md,
  },
  inlineInput: {
    flex: 1,
    minHeight: 36,
    backgroundColor: colors.background,
    color: colors.text,
    fontSize: fontSize.sm,
    borderRadius: borderRadius.md,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    textAlign: 'right',
  },
  numberInput: {
    width: 88,
    minHeight: 36,
    backgroundColor: colors.background,
    color: colors.text,
    fontSize: fontSize.sm,
    borderRadius: borderRadius.md,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
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
