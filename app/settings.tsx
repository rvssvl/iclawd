import { useState, useEffect } from 'react';
import { View, Text, StyleSheet, Pressable, Alert, ScrollView, TextInput, Platform, Switch, Linking, ActivityIndicator, ActionSheetIOS } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as Updates from 'expo-updates';
import Constants from 'expo-constants';
import * as SecureStore from '@/services/SafeSecureStore';
import { colors, spacing, fontSize, borderRadius } from '@/constants/theme';
import {
  deleteGatewayProfile,
  getActiveGatewayProfile,
  getGatewayProfiles,
  renameGatewayProfile,
  setActiveGatewayProfile,
} from '@/services/GatewayProfiles';
import { clearConversationHistory } from '@/services/ConversationHistory';
import { useGatewayContext } from '@/contexts/GatewayContext';
import { addSiriShortcut } from '@/services/SiriService';
import { isAnalyticsEnabled, setAnalyticsEnabled, track } from '@/services/AnalyticsService';
import type { GatewayProfile } from '@/types/gateway';
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
import {
  DEFAULT_VOICE_LANGUAGE,
  getVoiceLanguage,
  setVoiceLanguage,
  VOICE_LANGUAGE_OPTIONS,
} from '@/services/VoiceLanguageConfig';
import type { VoiceLanguageOption } from '@/services/VoiceLanguageConfig';
import { syncWatchConfiguration } from '@/services/WatchBridge';

const KEY_AUTO_PRONOUNCE = 'iclawd_auto_pronounce';
const KEY_NOTIFICATIONS = 'iclawd_notifications';
const OTA_CHANNEL = 'production';

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
  const { reconnect, activeGatewayId } = useGatewayContext();
  const [profiles, setProfiles] = useState<GatewayProfile[]>([]);
  const [activeProfile, setActiveProfile] = useState<GatewayProfile | null>(null);
  const [elevenLabsKey, setElevenLabsKey] = useState('');
  const [editingKey, setEditingKey] = useState(false);
  const [keyInput, setKeyInput] = useState('');
  const [autoPronounce, setAutoPronounce] = useState(true);
  const [notifications, setNotifications] = useState(true);
  const [checkingUpdate, setCheckingUpdate] = useState(false);
  const [usageAnalytics, setUsageAnalytics] = useState(true);
  const [ttsVoiceId, setTtsVoiceId] = useState(DEFAULT_ELEVENLABS_VOICE_ID);
  const [ttsSpeed, setTtsSpeed] = useState(String(DEFAULT_ELEVENLABS_TTS_SPEED));
  const [ttsStability, setTtsStability] = useState(String(DEFAULT_ELEVENLABS_TTS_STABILITY));
  const [ttsSimilarity, setTtsSimilarity] = useState(String(DEFAULT_ELEVENLABS_TTS_SIMILARITY));
  const [elevenLabsStt, setElevenLabsStt] = useState(false);
  const [voiceLanguage, setVoiceLanguageState] = useState<VoiceLanguageOption>(DEFAULT_VOICE_LANGUAGE);

  useEffect(() => {
    loadGatewayProfiles();
    getElevenLabsKey().then((k) => { if (k) setElevenLabsKey(k); });
    getElevenLabsTtsSettings().then((settings) => {
      setTtsVoiceId(settings.voiceId);
      setTtsSpeed(String(settings.speed));
      setTtsStability(String(settings.stability));
      setTtsSimilarity(String(settings.similarityBoost));
    });
    getVoiceLanguage().then(setVoiceLanguageState);
    SecureStore.getItemAsync(KEY_AUTO_PRONOUNCE).then((v) => setAutoPronounce(v !== 'false'));
    SecureStore.getItemAsync(KEY_NOTIFICATIONS).then((v) => setNotifications(v !== 'false'));
    isElevenLabsSttEnabled().then(setElevenLabsStt);
    isAnalyticsEnabled().then(setUsageAnalytics);
    track('settings_opened', { screen: 'settings' });
  }, []);

  async function loadGatewayProfiles() {
    const [nextProfiles, nextActive] = await Promise.all([
      getGatewayProfiles(),
      getActiveGatewayProfile(),
    ]);
    setProfiles(nextProfiles);
    setActiveProfile(nextActive);
  }

  function handleDeleteGateway(profile: GatewayProfile) {
    Alert.alert(
      'Delete Gateway',
      `Remove ${profile.name || 'this gateway'} from ClawVoice? Conversation history stays on this device unless you clear it separately.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            await deleteGatewayProfile(profile.id);
            track('gateway_deleted', { screen: 'settings', gateway_backend: profile.backend });
            await loadGatewayProfiles();
            await reconnect();
            await syncWatchConfiguration();
          },
        },
      ],
    );
  }

  async function handleSwitchGateway(profile: GatewayProfile) {
    await setActiveGatewayProfile(profile.id);
    track('gateway_switched', { screen: 'settings', gateway_backend: profile.backend });
    await loadGatewayProfiles();
    await reconnect();
    await syncWatchConfiguration();
  }

  function handleRenameGateway(profile: GatewayProfile) {
    if (Platform.OS !== 'ios' || !Alert.prompt) {
      Alert.alert('Rename Gateway', 'Rename is currently available from iOS prompts. You can delete and re-add the gateway with a new name.');
      return;
    }

    Alert.prompt(
      'Rename Gateway',
      'Choose a local display name.',
      async (nextName) => {
        if (!nextName?.trim()) return;
        await renameGatewayProfile(profile.id, nextName);
        await loadGatewayProfiles();
      },
      'plain-text',
      profile.name,
    );
  }

  function handleClearCurrentHistory() {
    if (!activeProfile) return;
    Alert.alert('Clear Current Conversation', 'This removes local messages for the active gateway from this device only.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Clear',
        style: 'destructive',
        onPress: async () => {
          await clearConversationHistory(activeProfile.id);
          track('conversation_history_cleared', { screen: 'settings', action: 'current' });
          await reconnect();
        },
      },
    ]);
  }

  function handleClearAllHistory() {
    Alert.alert('Clear All History', 'This removes all local ClawVoice conversation history from this device only.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Clear All',
        style: 'destructive',
        onPress: async () => {
          await clearConversationHistory();
          track('conversation_history_cleared', { screen: 'settings', action: 'all' });
          await reconnect();
        },
      },
    ]);
  }

  function handleEditKey() {
    setKeyInput(elevenLabsKey);
    setEditingKey(true);
  }

  async function handleSaveKey() {
    await saveElevenLabsKey(keyInput);
    setElevenLabsKey(keyInput.trim());
    if (keyInput.trim()) {
      track('elevenlabs_key_added', { screen: 'settings' });
    }
    if (!keyInput.trim()) {
      await setElevenLabsSttEnabled(false);
      setElevenLabsStt(false);
    }
    await syncWatchConfiguration();
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
          await syncWatchConfiguration();
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
    await syncWatchConfiguration();
    track('elevenlabs_stt_enabled', { screen: 'settings', enabled: value });
  }

  function handleSelectVoiceLanguage() {
    if (Platform.OS === 'ios') {
      const options = [...VOICE_LANGUAGE_OPTIONS.map((option) => option.label), 'Cancel'];
      const cancelButtonIndex = options.length - 1;
      ActionSheetIOS.showActionSheetWithOptions(
        {
          options,
          cancelButtonIndex,
          userInterfaceStyle: 'dark',
        },
        (buttonIndex) => {
          if (buttonIndex === cancelButtonIndex) return;
          const next = VOICE_LANGUAGE_OPTIONS[buttonIndex];
          if (!next) return;
          setVoiceLanguage(next.locale)
            .then(setVoiceLanguageState)
            .then(() => syncWatchConfiguration())
            .catch(() => {});
        },
      );
      return;
    }

    const currentIndex = VOICE_LANGUAGE_OPTIONS.findIndex((option) => option.locale === voiceLanguage.locale);
    const next = VOICE_LANGUAGE_OPTIONS[(currentIndex + 1) % VOICE_LANGUAGE_OPTIONS.length] || DEFAULT_VOICE_LANGUAGE;
    setVoiceLanguage(next.locale)
      .then(setVoiceLanguageState)
      .then(() => syncWatchConfiguration())
      .catch(() => {});
  }

  async function toggleUsageAnalytics(value: boolean) {
    setUsageAnalytics(value);
    await setAnalyticsEnabled(value);
    if (value) {
      await track('settings_opened', { screen: 'settings' });
    }
  }

  async function saveTtsSetting(key: string, value: string, setValue: (value: string) => void) {
    await saveElevenLabsTtsSetting(key, value);
    setValue(value.trim());
    track('elevenlabs_tts_setting_changed', { screen: 'settings', setting: key });
  }

  async function handleCheckForUpdates() {
    track('ota_check_tapped', { screen: 'settings' });
    if (__DEV__) {
      Alert.alert('Updates unavailable', 'OTA updates are disabled in development builds.');
      return;
    }

    setCheckingUpdate(true);
    try {
      prepareUpdateRequestHeaders();
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
      const message = getUpdateCheckErrorMessage(error);
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
  const appVersion = Constants.expoConfig?.version || 'Unavailable';

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      {/* Gateway Section */}
      <Text style={styles.sectionTitle}>Gateways</Text>
      <View style={styles.card}>
        {profiles.length > 0 ? (
          <>
            {profiles.map((profile, index) => (
              <View key={profile.id}>
                {index > 0 && <View style={styles.divider} />}
                <View style={styles.gatewayRow}>
                  <Pressable style={styles.gatewayMain} onPress={() => handleSwitchGateway(profile)}>
                    <Ionicons
                      name={profile.id === (activeProfile?.id || activeGatewayId) ? 'checkmark-circle' : 'ellipse-outline'}
                      size={20}
                      color={profile.id === (activeProfile?.id || activeGatewayId) ? colors.primaryLight : colors.textMuted}
                    />
                    <View style={styles.rowText}>
                      <Text style={styles.rowLabel}>{profile.name || 'OpenClaw Gateway'}</Text>
                      <Text style={styles.rowDescription} numberOfLines={1}>{safeHostLabel(profile.url)}</Text>
                    </View>
                  </Pressable>
                  <View style={styles.gatewayActions}>
                    <Pressable onPress={() => handleRenameGateway(profile)} hitSlop={8}>
                      <Ionicons name="pencil-outline" size={18} color={colors.textSecondary} />
                    </Pressable>
                    <Pressable onPress={() => handleDeleteGateway(profile)} hitSlop={8}>
                      <Ionicons name="trash-outline" size={18} color={colors.error} />
                    </Pressable>
                  </View>
                </View>
              </View>
            ))}
            <View style={styles.divider} />
            <Pressable style={styles.row} onPress={() => router.push('/connect')}>
              <Text style={styles.rowLabel}>Add Gateway</Text>
              <Ionicons name="add-circle-outline" size={18} color={colors.primary} />
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
        <Pressable style={styles.row} onPress={handleSelectVoiceLanguage}>
          <View style={styles.rowText}>
            <Text style={styles.rowLabel}>Language</Text>
            <Text style={styles.rowDescription}>Used for speech recognition, TTS, and gateway locale.</Text>
          </View>
          <Text style={styles.rowValue}>{voiceLanguage.label}</Text>
        </Pressable>
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
          <Text style={styles.sectionTitle}>Siri & Shortcuts</Text>
          <View style={styles.card}>
            <Pressable style={styles.row} onPress={() => addSiriShortcut()}>
              <Text style={styles.rowLabel}>Add to Siri</Text>
              <Ionicons name="mic-outline" size={18} color={colors.primary} />
            </Pressable>
            <View style={styles.divider} />
            <View style={styles.row}>
              <Text style={[styles.rowLabel, { fontSize: fontSize.sm, color: colors.textSecondary }]}>
                Add the suggested shortcut, then customize the phrase in Shortcuts or Siri settings.
              </Text>
            </View>
          </View>
        </>
      )}

      {/* History Section */}
      <Text style={styles.sectionTitle}>History</Text>
      <View style={styles.card}>
        <Pressable style={styles.row} onPress={handleClearCurrentHistory} disabled={!activeProfile}>
          <View style={styles.rowText}>
            <Text style={[styles.rowLabel, !activeProfile && styles.disabledText]}>Clear Current Conversation</Text>
            <Text style={styles.rowDescription}>Local messages for the active gateway only.</Text>
          </View>
          <Ionicons name="close-circle-outline" size={18} color={activeProfile ? colors.error : colors.textMuted} />
        </Pressable>
        <View style={styles.divider} />
        <Pressable style={styles.row} onPress={handleClearAllHistory}>
          <View style={styles.rowText}>
            <Text style={[styles.rowLabel, { color: colors.error }]}>Clear All Local History</Text>
            <Text style={styles.rowDescription}>Removes saved conversations from this device.</Text>
          </View>
          <Ionicons name="trash-outline" size={18} color={colors.error} />
        </Pressable>
      </View>

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

      {/* Privacy Section */}
      <Text style={styles.sectionTitle}>Privacy</Text>
      <View style={styles.card}>
        <View style={styles.row}>
          <View style={styles.rowText}>
            <Text style={styles.rowLabel}>Usage Analytics</Text>
            <Text style={styles.rowDescription}>
              Helps improve reliability and onboarding. No prompts, transcripts, messages, gateway URLs, or tokens are collected.
            </Text>
          </View>
          <Switch
            value={usageAnalytics}
            onValueChange={toggleUsageAnalytics}
            trackColor={{ false: colors.border, true: colors.primary }}
          />
        </View>
      </View>

      {/* About Section */}
      <Text style={styles.sectionTitle}>About</Text>
      <View style={styles.card}>
        <View style={styles.row}>
          <Text style={styles.rowLabel}>Version</Text>
          <Text style={styles.rowValue}>{appVersion}</Text>
        </View>
        <View style={styles.divider} />
        <View style={styles.row}>
          <Text style={styles.rowLabel}>Bundle</Text>
          <Text style={styles.rowValue} numberOfLines={1}>
            {bundleDate ? `${bundleLabel} · ${bundleDate}` : bundleLabel}
          </Text>
        </View>
        <View style={styles.divider} />
        <View style={styles.row}>
          <Text style={styles.rowLabel}>Update Channel</Text>
          <Text style={styles.rowValue}>{Updates.channel || 'Missing'}</Text>
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

function prepareUpdateRequestHeaders() {
  if (Updates.channel) return;

  try {
    Updates.setUpdateRequestHeadersOverride?.({ 'expo-channel-name': OTA_CHANNEL });
  } catch {
    // Older or strictly configured binaries cannot override update headers at runtime.
  }
}

function getUpdateCheckErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error || '');
  const normalized = message.toLowerCase();

  if (normalized.includes('expo-channel-name') || normalized.includes('channel-name')) {
    return 'This installed build is missing the production OTA channel. Install the next App Store/TestFlight build once, then manual update checks will work normally.';
  }

  return message || 'Could not check for updates.';
}

function safeHostLabel(url: string): string {
  try {
    return new URL(url).host || 'OpenClaw gateway';
  } catch {
    return url.replace(/^wss?:\/\//, '').split('/')[0] || 'OpenClaw gateway';
  }
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
  rowText: {
    flex: 1,
    paddingRight: spacing.md,
  },
  gatewayRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    minHeight: 58,
    gap: spacing.md,
  },
  gatewayMain: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  gatewayActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  disabledText: {
    color: colors.textMuted,
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
