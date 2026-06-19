import * as SecureStore from '@/services/SafeSecureStore';

export const VOICE_LANGUAGE_KEY = 'iclawd_voice_language';

export interface VoiceLanguageOption {
  label: string;
  locale: string;
  languageCode: string;
}

export const VOICE_LANGUAGE_OPTIONS: VoiceLanguageOption[] = [
  { label: 'English (US)', locale: 'en-US', languageCode: 'en' },
  { label: 'Spanish', locale: 'es-ES', languageCode: 'es' },
  { label: 'French', locale: 'fr-FR', languageCode: 'fr' },
  { label: 'German', locale: 'de-DE', languageCode: 'de' },
  { label: 'Italian', locale: 'it-IT', languageCode: 'it' },
  { label: 'Portuguese (Brazil)', locale: 'pt-BR', languageCode: 'pt' },
  { label: 'Russian', locale: 'ru-RU', languageCode: 'ru' },
  { label: 'Turkish', locale: 'tr-TR', languageCode: 'tr' },
  { label: 'Chinese (Simplified)', locale: 'zh-CN', languageCode: 'zh' },
  { label: 'Japanese', locale: 'ja-JP', languageCode: 'ja' },
  { label: 'Korean', locale: 'ko-KR', languageCode: 'ko' },
  { label: 'Kazakh', locale: 'kk-KZ', languageCode: 'kk' },
];

export const DEFAULT_VOICE_LANGUAGE = VOICE_LANGUAGE_OPTIONS[0];

export async function getVoiceLanguage(): Promise<VoiceLanguageOption> {
  const stored = await SecureStore.getItemAsync(VOICE_LANGUAGE_KEY);
  return VOICE_LANGUAGE_OPTIONS.find((option) => option.locale === stored) || DEFAULT_VOICE_LANGUAGE;
}

export async function setVoiceLanguage(locale: string): Promise<VoiceLanguageOption> {
  const next = VOICE_LANGUAGE_OPTIONS.find((option) => option.locale === locale) || DEFAULT_VOICE_LANGUAGE;
  await SecureStore.setItemAsync(VOICE_LANGUAGE_KEY, next.locale);
  return next;
}
