import { NativeEventEmitter, NativeModules, Platform } from 'react-native';
import * as SecureStore from '@/services/SafeSecureStore';
import { ELEVENLABS_KEY, isElevenLabsSttEnabled, isValidElevenLabsApiKey } from '@/services/ElevenLabsConfig';
import { getGatewayConfig } from '@/services/SecureStorage';
import { getVoiceLanguage } from '@/services/VoiceLanguageConfig';

export type WatchCommandAction = 'startVoice' | 'stopAudio' | 'pauseVoice' | 'requestStatus';

export interface WatchCommand {
  action: WatchCommandAction;
  timestamp?: number;
}

export interface WatchStatus {
  state: 'ready' | 'connecting' | 'listening' | 'thinking' | 'speaking' | 'paused' | 'error';
  title: string;
  subtitle?: string;
}

export interface WatchConfiguration {
  gatewayUrl: string;
  gatewayToken: string;
  elevenLabsKey?: string;
  languageCode: string;
  locale: string;
}

type NativeWatchBridge = {
  setStatus?: (status: WatchStatus) => void;
  setConfiguration?: (configuration: WatchConfiguration | { clear: true }) => void;
};

const nativeBridge = Platform.OS === 'ios'
  ? (NativeModules.WatchBridge as NativeWatchBridge | undefined)
  : undefined;

const emitter = nativeBridge ? new NativeEventEmitter(NativeModules.WatchBridge) : null;

export function addWatchCommandListener(listener: (command: WatchCommand) => void) {
  if (!emitter) return () => {};

  const subscription = emitter.addListener('clawVoiceWatchCommand', listener);
  return () => subscription.remove();
}

export function setWatchStatus(status: WatchStatus) {
  nativeBridge?.setStatus?.(status);
}

export function setWatchConfiguration(configuration: WatchConfiguration) {
  nativeBridge?.setConfiguration?.(configuration);
}

export async function syncWatchConfiguration(): Promise<boolean> {
  const [configuration, sttEnabled, elevenLabsKey, language] = await Promise.all([
    getGatewayConfig(),
    isElevenLabsSttEnabled(),
    SecureStore.getItemAsync(ELEVENLABS_KEY),
    getVoiceLanguage(),
  ]);
  if (!configuration) {
    nativeBridge?.setConfiguration?.({ clear: true });
    return false;
  }

  setWatchConfiguration({
    gatewayUrl: configuration.url,
    gatewayToken: configuration.token,
    ...(sttEnabled && isValidElevenLabsApiKey(elevenLabsKey) ? { elevenLabsKey: elevenLabsKey.trim() } : {}),
    languageCode: language.languageCode,
    locale: language.locale,
  });
  return true;
}
