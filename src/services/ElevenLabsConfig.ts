import * as SecureStore from '@/services/SafeSecureStore';

export const ELEVENLABS_KEY = 'iclawd_elevenlabs_key';
export const ELEVENLABS_TTS_VOICE_ID = 'iclawd_elevenlabs_voice_id';
export const ELEVENLABS_TTS_SPEED = 'iclawd_elevenlabs_tts_speed';
export const ELEVENLABS_TTS_STABILITY = 'iclawd_elevenlabs_tts_stability';
export const ELEVENLABS_TTS_SIMILARITY = 'iclawd_elevenlabs_tts_similarity';
export const ELEVENLABS_STT_ENABLED = 'iclawd_elevenlabs_stt_enabled';

export const DEFAULT_ELEVENLABS_VOICE_ID = 'JBFqnCBsd6RMkjVDRZzb';
export const DEFAULT_ELEVENLABS_TTS_SPEED = 1;
export const DEFAULT_ELEVENLABS_TTS_STABILITY = 0.5;
export const DEFAULT_ELEVENLABS_TTS_SIMILARITY = 0.75;

export interface ElevenLabsTtsSettings {
  voiceId: string;
  speed: number;
  stability: number;
  similarityBoost: number;
}

function clamp(value: number, min: number, max: number): number {
  if (Number.isNaN(value)) return min;
  return Math.min(max, Math.max(min, value));
}

async function getNumber(key: string, fallback: number, min: number, max: number): Promise<number> {
  const raw = await SecureStore.getItemAsync(key);
  if (!raw) return fallback;
  return clamp(Number(raw), min, max);
}

export async function getElevenLabsTtsSettings(): Promise<ElevenLabsTtsSettings> {
  const [voiceId, speed, stability, similarityBoost] = await Promise.all([
    SecureStore.getItemAsync(ELEVENLABS_TTS_VOICE_ID),
    getNumber(ELEVENLABS_TTS_SPEED, DEFAULT_ELEVENLABS_TTS_SPEED, 0.7, 1.2),
    getNumber(ELEVENLABS_TTS_STABILITY, DEFAULT_ELEVENLABS_TTS_STABILITY, 0, 1),
    getNumber(ELEVENLABS_TTS_SIMILARITY, DEFAULT_ELEVENLABS_TTS_SIMILARITY, 0, 1),
  ]);

  return {
    voiceId: voiceId?.trim() || DEFAULT_ELEVENLABS_VOICE_ID,
    speed,
    stability,
    similarityBoost,
  };
}

export async function isElevenLabsSttEnabled(): Promise<boolean> {
  const [enabled, apiKey] = await Promise.all([
    SecureStore.getItemAsync(ELEVENLABS_STT_ENABLED),
    SecureStore.getItemAsync(ELEVENLABS_KEY),
  ]);
  return enabled === 'true' && Boolean(apiKey?.trim());
}

export async function setElevenLabsSttEnabled(enabled: boolean): Promise<void> {
  await SecureStore.setItemAsync(ELEVENLABS_STT_ENABLED, String(enabled));
}

export async function saveElevenLabsTtsSetting(key: string, value: string): Promise<void> {
  const trimmed = value.trim();
  if (trimmed) {
    await SecureStore.setItemAsync(key, trimmed);
  } else {
    await SecureStore.deleteItemAsync(key);
  }
}
