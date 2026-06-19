import { Platform } from 'react-native';
import Constants from 'expo-constants';
import * as Updates from 'expo-updates';
import * as SecureStore from '@/services/SafeSecureStore';

export const ANALYTICS_ENABLED_KEY = 'iclawd_analytics_enabled';

const FIRST_TOUCH_KEY = 'iclawd_analytics_first_touch';
const TRACK_ONCE_PREFIX = 'iclawd_analytics_once_';
const LAST_EVENT_NAME_KEY = 'iclawd_analytics_last_event_name';
const LAST_EVENT_AT_KEY = 'iclawd_analytics_last_event_at';
const LAST_EVENT_STATUS_KEY = 'iclawd_analytics_last_event_status';
const LAST_EVENT_ERROR_KEY = 'iclawd_analytics_last_event_error';
const MAX_STRING_LENGTH = 80;

type AnalyticsValue = string | number | boolean | null | undefined;
type AnalyticsProps = Record<string, AnalyticsValue>;
type AnalyticsStatus = 'sent' | 'disabled' | 'module_missing' | 'failed';

export interface AnalyticsDiagnostics {
  enabled: boolean;
  moduleLoaded: boolean;
  appId?: string;
  projectId?: string;
  lastEventName?: string | null;
  lastEventAt?: string | null;
  lastEventStatus?: AnalyticsStatus | null;
  lastEventError?: string | null;
}

const ALLOWED_EVENTS = new Set([
  'app_opened',
  'settings_opened',
  'analytics_test_sent',
  'ota_check_tapped',
  'onboarding_viewed',
  'connect_selected',
  'setup_guide_selected',
  'connect_attempted',
  'connect_succeeded',
  'connect_failed',
  'first_chat_sent',
  'first_voice_started',
  'first_agent_response_received',
  'voice_started',
  'voice_no_speech',
  'voice_stt_failed',
  'voice_tts_failed',
  'voice_audio_interrupted',
  'voice_stopped_audio',
  'carplay_opened',
  'carplay_voice_started',
  'carplay_voice_paused',
  'carplay_audio_stopped',
  'watch_opened',
  'watch_voice_started',
  'watch_voice_paused',
  'watch_audio_stopped',
  'watch_connection_failed',
  'elevenlabs_key_added',
  'elevenlabs_stt_enabled',
  'elevenlabs_tts_setting_changed',
  'siri_shortcut_suggested',
  'siri_shortcut_failed',
]);

const ALLOWED_PROPS = new Set([
  'app_version',
  'runtime_version',
  'platform',
  'screen',
  'provider',
  'connection_result',
  'error_category',
  'carplay',
  'watch',
  'source',
  'campaign',
  'medium',
  'url_type',
  'enabled',
  'setting',
  'action',
]);

let cachedEnabled: boolean | null = null;
let firebaseAnalytics: null | { logEvent: (name: string, params?: AnalyticsProps) => Promise<void>; setAnalyticsCollectionEnabled: (enabled: boolean) => Promise<void> } = null;
let firebaseLoadAttempted = false;
let firebaseLoadError: string | null = null;

export async function initializeAnalytics(): Promise<void> {
  const enabled = await isAnalyticsEnabled();
  await setFirebaseCollectionEnabled(enabled);
}

export async function isAnalyticsEnabled(): Promise<boolean> {
  if (cachedEnabled !== null) return cachedEnabled;
  const stored = await SecureStore.getItemAsync(ANALYTICS_ENABLED_KEY);
  cachedEnabled = stored !== 'false';
  return cachedEnabled;
}

export async function setAnalyticsEnabled(enabled: boolean): Promise<void> {
  cachedEnabled = enabled;
  await SecureStore.setItemAsync(ANALYTICS_ENABLED_KEY, String(enabled));
  await setFirebaseCollectionEnabled(enabled);
}

export async function track(eventName: string, props: AnalyticsProps = {}): Promise<void> {
  if (!ALLOWED_EVENTS.has(eventName)) return;
  if (!(await isAnalyticsEnabled())) {
    await recordAnalyticsAttempt(eventName, 'disabled');
    return;
  }

  const analytics = getFirebaseAnalytics();
  if (!analytics) {
    await recordAnalyticsAttempt(eventName, 'module_missing', firebaseLoadError);
    if (__DEV__) {
      console.log('[Analytics]', eventName, sanitizeProps(props));
    }
    return;
  }

  try {
    await analytics.logEvent(eventName, await withCommonProps(props));
    await recordAnalyticsAttempt(eventName, 'sent');
  } catch (error) {
    await recordAnalyticsAttempt(eventName, 'failed', getErrorMessage(error));
    if (__DEV__) {
      console.warn('[Analytics] logEvent failed:', error);
    }
  }
}

export async function trackOnce(eventName: string, props: AnalyticsProps = {}): Promise<void> {
  if (!(await isAnalyticsEnabled())) return;
  const key = `${TRACK_ONCE_PREFIX}${eventName}`;
  const seen = await SecureStore.getItemAsync(key);
  if (seen === 'true') return;
  await SecureStore.setItemAsync(key, 'true');
  await track(eventName, props);
}

export async function sendAnalyticsTestEvent(): Promise<AnalyticsDiagnostics> {
  await track('analytics_test_sent', { screen: 'settings', action: 'manual_test' });
  return getAnalyticsDiagnostics();
}

export async function getAnalyticsDiagnostics(): Promise<AnalyticsDiagnostics> {
  const enabled = await isAnalyticsEnabled();
  const analytics = getFirebaseAnalytics();
  const appInfo = getFirebaseAppInfo();

  return {
    enabled,
    moduleLoaded: Boolean(analytics),
    appId: appInfo.appId,
    projectId: appInfo.projectId,
    lastEventName: await SecureStore.getItemAsync(LAST_EVENT_NAME_KEY),
    lastEventAt: await SecureStore.getItemAsync(LAST_EVENT_AT_KEY),
    lastEventStatus: (await SecureStore.getItemAsync(LAST_EVENT_STATUS_KEY)) as AnalyticsStatus | null,
    lastEventError: await SecureStore.getItemAsync(LAST_EVENT_ERROR_KEY),
  };
}

export async function captureCampaignFromUrl(url: string | null | undefined): Promise<void> {
  if (!url) return;

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return;
  }

  const source = cleanString(parsed.searchParams.get('source') || parsed.searchParams.get('utm_source'));
  const campaign = cleanString(parsed.searchParams.get('campaign') || parsed.searchParams.get('utm_campaign'));
  const medium = cleanString(parsed.searchParams.get('medium') || parsed.searchParams.get('utm_medium'));
  if (!source && !campaign && !medium) return;

  const existing = await SecureStore.getItemAsync(FIRST_TOUCH_KEY);
  if (existing) return;

  await SecureStore.setItemAsync(FIRST_TOUCH_KEY, JSON.stringify({ source, campaign, medium }));
}

export function categorizeError(error: unknown): string {
  const message = error instanceof Error
    ? error.message
    : typeof error === 'string'
      ? error
      : '';
  const normalized = message.toLowerCase();

  if (normalized.includes('permission') || normalized.includes('not authorized')) return 'permission';
  if (normalized.includes('auth') || normalized.includes('token') || normalized.includes('401') || normalized.includes('403')) return 'auth';
  if (normalized.includes('timeout') || normalized.includes('timed out')) return 'timeout';
  if (normalized.includes('network') || normalized.includes('websocket') || normalized.includes('socket')) return 'network';
  if (normalized.includes('audio') || normalized.includes('background') || normalized.includes('session')) return 'audio_session';
  if (
    normalized.includes('no_match')
    || normalized.includes('recognition_fail')
    || normalized.includes('understand')
    || normalized.includes('did not hear')
    || normalized.includes('clear speech')
    || normalized.includes('hear enough speech')
  ) return 'stt_no_match';
  if (normalized.includes('tts') || normalized.includes('elevenlabs') || normalized.includes('speech')) return 'tts_provider';
  return 'unknown';
}

export function getGatewayUrlType(rawUrl: string): string {
  try {
    const host = new URL(rawUrl).hostname.toLowerCase();
    if (host === 'localhost' || host === '127.0.0.1' || host === '::1') return 'localhost';
    if (/^100\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host)) return 'tailscale';
    if (/^(10|172|192)\./.test(host)) return 'private_ip';
    if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(host)) return 'public_ip';
    if (host.endsWith('.local')) return 'local_domain';
    return 'domain';
  } catch {
    return 'unknown';
  }
}

async function withCommonProps(props: AnalyticsProps): Promise<AnalyticsProps> {
  const firstTouch = await getFirstTouch();
  return sanitizeProps({
    app_version: Constants.expoConfig?.version,
    runtime_version: getRuntimeVersion(),
    platform: Platform.OS,
    ...firstTouch,
    ...props,
  });
}

function getRuntimeVersion(): string | undefined {
  if (Updates.runtimeVersion) return Updates.runtimeVersion;
  const runtimeVersion = Constants.expoConfig?.runtimeVersion;
  if (typeof runtimeVersion === 'string') return runtimeVersion;
  return runtimeVersion?.policy;
}

async function getFirstTouch(): Promise<AnalyticsProps> {
  const raw = await SecureStore.getItemAsync(FIRST_TOUCH_KEY);
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as AnalyticsProps;
    return {
      source: parsed.source,
      campaign: parsed.campaign,
      medium: parsed.medium,
    };
  } catch {
    return {};
  }
}

function sanitizeProps(props: AnalyticsProps): AnalyticsProps {
  const next: AnalyticsProps = {};
  Object.entries(props).forEach(([key, value]) => {
    if (!ALLOWED_PROPS.has(key) || value === undefined || value === null) return;
    if (typeof value === 'string') {
      const cleaned = cleanString(value);
      if (cleaned) next[key] = cleaned;
      return;
    }
    if (typeof value === 'number' || typeof value === 'boolean') {
      next[key] = value;
    }
  });
  return next;
}

function cleanString(value: unknown): string {
  if (typeof value !== 'string') return '';
  return value
    .trim()
    .slice(0, MAX_STRING_LENGTH)
    .replace(/[^a-zA-Z0-9_.:-]/g, '_');
}

function getFirebaseAnalytics() {
  if (firebaseLoadAttempted) return firebaseAnalytics;
  firebaseLoadAttempted = true;

  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const analyticsModule = require('@react-native-firebase/analytics').default;
    firebaseAnalytics = analyticsModule();
    firebaseLoadError = null;
  } catch (error) {
    firebaseAnalytics = null;
    firebaseLoadError = getErrorMessage(error);
    if (__DEV__) {
      console.warn('[Analytics] Firebase Analytics unavailable:', error);
    }
  }

  return firebaseAnalytics;
}

function getFirebaseAppInfo(): Pick<AnalyticsDiagnostics, 'appId' | 'projectId'> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const firebaseAppModule = require('@react-native-firebase/app').default;
    const app = typeof firebaseAppModule.app === 'function'
      ? firebaseAppModule.app()
      : typeof firebaseAppModule === 'function'
        ? firebaseAppModule()
        : null;
    const options = app?.options ?? {};
    return {
      appId: cleanString(options.appId),
      projectId: cleanString(options.projectId),
    };
  } catch {
    return {};
  }
}

async function recordAnalyticsAttempt(eventName: string, status: AnalyticsStatus, error?: string | null): Promise<void> {
  try {
    await SecureStore.setItemAsync(LAST_EVENT_NAME_KEY, eventName);
    await SecureStore.setItemAsync(LAST_EVENT_AT_KEY, new Date().toISOString());
    await SecureStore.setItemAsync(LAST_EVENT_STATUS_KEY, status);
    if (error) {
      await SecureStore.setItemAsync(LAST_EVENT_ERROR_KEY, cleanString(error));
    } else {
      await SecureStore.deleteItemAsync(LAST_EVENT_ERROR_KEY);
    }
  } catch {
    // Diagnostics should never break product behavior.
  }
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  return 'unknown';
}

async function setFirebaseCollectionEnabled(enabled: boolean): Promise<void> {
  const analytics = getFirebaseAnalytics();
  if (!analytics) return;

  try {
    await analytics.setAnalyticsCollectionEnabled(enabled);
  } catch (error) {
    if (__DEV__) {
      console.warn('[Analytics] setAnalyticsCollectionEnabled failed:', error);
    }
  }
}
