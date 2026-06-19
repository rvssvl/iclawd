import Voice, {
  SpeechResultsEvent,
  SpeechErrorEvent,
} from '@react-native-voice/voice';
import { Audio, InterruptionModeIOS } from 'expo-av';
import type { RecordingStatus } from 'expo-av/build/Audio/Recording.types';
import * as FileSystem from 'expo-file-system/legacy';
import * as SecureStore from '@/services/SafeSecureStore';
import Tts, { TtsEvent } from 'react-native-tts';
import {
  ELEVENLABS_KEY,
  ELEVENLABS_STT_ENABLED,
  getElevenLabsTtsSettings,
  isElevenLabsSttEnabled,
} from '@/services/ElevenLabsConfig';
import { ElevenLabsSpeechError, transcribeWithElevenLabs } from '@/services/ElevenLabsSpeechService';
import { getVoiceLanguage } from '@/services/VoiceLanguageConfig';
import { categorizeError, track } from '@/services/AnalyticsService';

export type VoiceState = 'idle' | 'listening' | 'thinking' | 'preparingAudio' | 'speaking';
export type VoiceInputProvider = 'system' | 'elevenlabs';

type StateListener = (state: VoiceState) => void;
type InputProviderListener = (provider: VoiceInputProvider) => void;
type TranscriptListener = (text: string, isFinal: boolean) => void;
type ErrorListener = (error: string) => void;
interface SuspendOptions {
  keepPlayback?: boolean;
}

const ELEVENLABS_MODEL = 'eleven_flash_v2_5';
const ELEVENLABS_AUTH_FAILURE = /HTTP\s+(401|403)\b/i;
const ELEVENLABS_TTS_TIMEOUT_MS = 30000;
const QUICK_MANUAL_STOP_MS = 700;
const NO_SPEECH_TIMEOUT_MS = 6000;
const STUCK_LISTENING_GUARD_MS = 30000;
const ACTIVE_SPEECH_GRACE_MS = 2500;
const POST_TTS_COOLDOWN_MS = 1000;

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Timed out')), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

async function settleTtsOption(label: string, option: () => Promise<unknown>): Promise<void> {
  try {
    await option();
  } catch (error) {
    console.warn(`[VoiceEngine] Ignoring native TTS option failure (${label}):`, error);
  }
}

function formatSpeechError(code: unknown): string {
  const normalizedCode = typeof code === 'string' ? code.toLowerCase() : '';

  if (normalizedCode === 'recognition_fail') {
    return 'Speech recognition did not hear clear speech. If you are using the simulator, test with a real iPhone microphone.';
  }

  if (normalizedCode.includes('not_authorized') || normalizedCode.includes('permission')) {
    return 'Microphone or speech recognition permission is not enabled.';
  }

  if (normalizedCode.includes('no_match')) {
    return 'I could not understand that. Try speaking again.';
  }

  return 'Speech recognition error. Try again from the physical iPhone microphone.';
}

function formatAudioError(error: unknown): string {
  const message = error instanceof Error
    ? error.message
    : typeof error === 'string'
      ? error
      : error && typeof error === 'object' && 'message' in error
        ? String((error as { message?: unknown }).message ?? '')
        : '';
  const normalized = message.toLowerCase();

  if (normalized.includes('background')) {
    return 'Open ClawVoice in the foreground to use the microphone.';
  }
  if (normalized.includes('permission') || normalized.includes('not authorized')) {
    return 'Microphone permission is required.';
  }

  return message || 'Could not start microphone';
}

class VoiceEngineService {
  private stateListeners = new Set<StateListener>();
  private inputProviderListeners = new Set<InputProviderListener>();
  private transcriptListeners = new Set<TranscriptListener>();
  private errorListeners = new Set<ErrorListener>();
  private _state: VoiceState = 'idle';
  private _inputProvider: VoiceInputProvider = 'system';
  private initialized = false;
  private latestTranscript = '';
  private listeningStartedAt = 0;
  private speechStarted = false;
  private lastSpeechActivityAt = 0;
  private static MIN_LISTEN_MS = 800;
  private sound: Audio.Sound | null = null;
  private continuousMode = false;
  private silenceTimer: ReturnType<typeof setTimeout> | null = null;
  private noSpeechTimer: ReturnType<typeof setTimeout> | null = null;
  private stuckListeningTimer: ReturnType<typeof setTimeout> | null = null;
  private postTtsTimer: ReturnType<typeof setTimeout> | null = null;
  private listeningGeneration = 0;
  private playbackGeneration = 0;
  private operationQueue: Promise<void> = Promise.resolve();
  private recognizing = false;
  private recognitionHandlersBound = false;
  private static SILENCE_TIMEOUT_MS = 1500;
  private static STT_SILENCE_THRESHOLD_DB = -45;
  private static STT_SPEECH_THRESHOLD_DB = -36;
  private recording: Audio.Recording | null = null;
  private recordingProvider: 'elevenlabs' | null = null;
  private recordingHeardSpeech = false;
  private recordingSilentSince = 0;
  private transcriptionInProgress = false;
  private ttsCleanup: (() => void) | null = null;

  get state(): VoiceState {
    return this._state;
  }

  get inputProvider(): VoiceInputProvider {
    return this._inputProvider;
  }

  async init(): Promise<void> {
    await this.initRecognition();
  }

  private bindRecognitionHandlers(): void {
    if (this.recognitionHandlersBound) return;

    Voice.onSpeechResults = this.onSpeechResults.bind(this);
    Voice.onSpeechPartialResults = this.onSpeechPartial.bind(this);
    Voice.onSpeechError = this.onSpeechError.bind(this);
    Voice.onSpeechEnd = this.onSpeechEnd.bind(this);
    this.recognitionHandlersBound = true;
  }

  private async initRecognition(): Promise<void> {
    if (this.initialized) return;

    this.bindRecognitionHandlers();
    await this.useRecordingAudioMode();

    const available = await Voice.isAvailable();
    if (!available) {
      throw new Error('Speech recognition is not available on this device.');
    }

    this.initialized = true;
  }

  onStateChange(listener: StateListener): () => void {
    this.stateListeners.add(listener);
    return () => this.stateListeners.delete(listener);
  }

  onInputProviderChange(listener: InputProviderListener): () => void {
    this.inputProviderListeners.add(listener);
    return () => this.inputProviderListeners.delete(listener);
  }

  onTranscript(listener: TranscriptListener): () => void {
    this.transcriptListeners.add(listener);
    return () => this.transcriptListeners.delete(listener);
  }

  onError(listener: ErrorListener): () => void {
    this.errorListeners.add(listener);
    return () => this.errorListeners.delete(listener);
  }

  async startListening(continuous = false): Promise<void> {
    return this.enqueueOperation(async () => {
      if (this._state === 'speaking' || this._state === 'preparingAudio') {
        return;
      }

      await this.useRecordingAudioMode();
      this.continuousMode = continuous;

      if (this._state === 'listening' || this.recognizing || this.recording) {
        return;
      }

      this.resetListeningSession();
      await this.stopSound();
      await this.stopTts();
      this.latestTranscript = '';

      await this.stopRecognition('cancel');

      if (await isElevenLabsSttEnabled()) {
        await this.startElevenLabsRecording();
        return;
      }

      await this.initRecognition();
      this.setInputProvider('system');

      this.markListeningStarted();
      this.setState('listening');

      try {
        this.recognizing = true;
        const language = await getVoiceLanguage();
        await Voice.start(language.locale);
      } catch (e) {
        if (this.isAlreadyStartedError(e)) {
          this.recognizing = true;
          this.setState('listening');
          return;
        }
        this.recognizing = false;
        this.clearListeningTimers();
        console.warn('[VoiceEngine] Failed to start listening:', e);
        this.notifyError(formatAudioError(e));
        this.setState('idle');
      }
    });
  }

  async stopListening(): Promise<void> {
    return this.enqueueOperation(async () => {
      this.continuousMode = false;
      this.clearListeningTimers();
      const elapsed = Date.now() - this.listeningStartedAt;

      if (elapsed < QUICK_MANUAL_STOP_MS) {
        this.latestTranscript = '';
        await this.finishElevenLabsRecording('cancel');
        await this.stopRecognition('cancel');
        if (this._state === 'listening') {
          this.setState('idle');
        }
        return;
      }

      if (this.recordingProvider === 'elevenlabs' || this.recording) {
        await this.finishElevenLabsRecording('manual');
        return;
      }
      if (this.latestTranscript.trim()) {
        await this.finalizeCurrentTranscript('manual');
        return;
      }
      this.latestTranscript = '';
      await this.stopRecognition('stop');
      if (this._state === 'listening') {
        this.setState('idle');
      }
    });
  }

  async speak(text: string): Promise<void> {
    await this.prepareForPlayback();
    this.setState('preparingAudio');

    const elevenLabsKey = await SecureStore.getItemAsync(ELEVENLABS_KEY);
    console.log('[VoiceEngine] speak() — ElevenLabs:', elevenLabsKey ? 'configured' : 'not set');
    if (elevenLabsKey) {
      await this.speakWithElevenLabs(text, elevenLabsKey);
    } else {
      await this.speakWithSystem(text);
    }
  }

  private async speakWithSystem(text: string): Promise<void> {
    await this.stopTts();

    let initStatus: Promise<'success'>;
    try {
      initStatus = Tts.getInitStatus();
    } catch (error) {
      console.warn('[VoiceEngine] Native TTS init threw:', error);
      track('voice_tts_failed', { provider: 'system', error_category: categorizeError(error) });
      this.onSpeechDone();
      return;
    }

    const ttsReady = await withTimeout(initStatus, 2000).then(
      () => true,
      (error) => {
        console.warn('[VoiceEngine] Native TTS init failed:', error);
        track('voice_tts_failed', { provider: 'system', error_category: categorizeError(error) });
        return false;
      },
    );
    if (!ttsReady) {
      this.setState('idle');
      return;
    }

    await Promise.all([
      settleTtsOption('ignoreSilentSwitch', () => Tts.setIgnoreSilentSwitch('ignore')),
      settleTtsOption('language', async () => Tts.setDefaultLanguage((await getVoiceLanguage()).locale)),
      settleTtsOption('rate', () => Tts.setDefaultRate(0.48)),
      settleTtsOption('pitch', () => Tts.setDefaultPitch(1.0)),
    ]);

    await this.usePlaybackAudioMode(true);
    let started = false;
    let completed = false;
    let utteranceId: string | number | null = null;

    const matchesUtterance = (event: TtsEvent | { utteranceId?: string | number }) => {
      if (!utteranceId || !('utteranceId' in event)) return true;
      return String(event.utteranceId) === String(utteranceId);
    };

    const cleanup = () => {
      clearTimeout(startWatchdog);
      try {
        Tts.removeEventListener('tts-start', handleStart);
        Tts.removeEventListener('tts-finish', handleFinish);
        Tts.removeEventListener('tts-cancel', handleFinish);
      } catch {
        // Some native emitters throw during teardown after failed setup.
      }
      if (this.ttsCleanup === cleanup) {
        this.ttsCleanup = null;
      }
    };

    const finish = () => {
      if (completed) return;
      completed = true;
      cleanup();
      this.onSpeechDone().catch((error) => {
        console.warn('[VoiceEngine] Failed to finish native TTS:', error);
      });
    };

    const handleStart = (event: TtsEvent) => {
      if (!matchesUtterance(event) || completed) return;
      started = true;
      clearTimeout(startWatchdog);
      this.setState('speaking');
    };

    const handleFinish = (event: TtsEvent) => {
      if (!matchesUtterance(event)) return;
      finish();
    };

    const startWatchdog = setTimeout(() => {
      if (started || completed) return;
      console.warn('[VoiceEngine] Native TTS did not report playback start.');
      this.stopNativeTts();
      finish();
    }, 2500);

    try {
      Tts.addEventListener('tts-start', handleStart);
      Tts.addEventListener('tts-finish', handleFinish);
      Tts.addEventListener('tts-cancel', handleFinish);
      this.ttsCleanup = cleanup;
    } catch (error) {
      console.warn('[VoiceEngine] Failed to subscribe to native TTS events:', error);
      track('voice_tts_failed', { provider: 'system', error_category: categorizeError(error) });
      finish();
      return;
    }

    try {
      utteranceId = Tts.speak(text);
    } catch (error) {
      console.warn('[VoiceEngine] Failed to queue native TTS:', error);
      track('voice_tts_failed', { provider: 'system', error_category: categorizeError(error) });
      finish();
    }
  }

  private elevenLabsFailShown = false;

  // Pure JS base64 encoder — works reliably in Hermes (unlike btoa for binary)
  private static toBase64(bytes: Uint8Array): string {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
    const len = bytes.length;
    const parts: string[] = [];
    for (let i = 0; i < len; i += 3) {
      const a = bytes[i];
      const b = i + 1 < len ? bytes[i + 1] : 0;
      const c = i + 2 < len ? bytes[i + 2] : 0;
      parts.push(
        chars[a >> 2],
        chars[((a & 3) << 4) | (b >> 4)],
        i + 1 < len ? chars[((b & 15) << 2) | (c >> 6)] : '=',
        i + 2 < len ? chars[c & 63] : '=',
      );
    }
    return parts.join('');
  }

  private async speakWithElevenLabs(text: string, apiKey: string): Promise<void> {
    try {
      console.log('[VoiceEngine] ElevenLabs: starting request...');
      const settings = await getElevenLabsTtsSettings();
      const language = await getVoiceLanguage();

      const requestAudio = () => new Promise<ArrayBuffer>((resolve, reject) => {
          const xhr = new XMLHttpRequest();
          xhr.open('POST', `https://api.elevenlabs.io/v1/text-to-speech/${settings.voiceId}`);
          xhr.setRequestHeader('xi-api-key', apiKey);
          xhr.setRequestHeader('Content-Type', 'application/json');
          xhr.responseType = 'arraybuffer';
          xhr.timeout = ELEVENLABS_TTS_TIMEOUT_MS;

          xhr.onload = () => {
            console.log('[VoiceEngine] XHR status:', xhr.status, 'response type:', typeof xhr.response);
            if (xhr.status !== 200) {
              // Try to read error as text
              try {
                const decoder = new TextDecoder();
                const errText = decoder.decode(new Uint8Array(xhr.response));
                reject(new Error(`HTTP ${xhr.status}: ${errText.slice(0, 200)}`));
              } catch {
                reject(new Error(`HTTP ${xhr.status}`));
              }
              return;
            }
            if (!xhr.response || !(xhr.response instanceof ArrayBuffer)) {
              reject(new Error(`Invalid response type: ${typeof xhr.response}`));
              return;
            }
            resolve(xhr.response);
          };
          xhr.onerror = () => reject(new Error('Network error'));
          xhr.ontimeout = () => reject(new Error('Request timeout'));

          xhr.send(JSON.stringify({
            text,
            model_id: ELEVENLABS_MODEL,
            language_code: language.languageCode,
            voice_settings: {
              stability: settings.stability,
              similarity_boost: settings.similarityBoost,
              speed: settings.speed,
            },
          }));
        });

      // Use XHR with arraybuffer responseType — most reliable binary method in RN Hermes
      let arrayBuffer: ArrayBuffer;
      try {
        arrayBuffer = await requestAudio();
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (ELEVENLABS_AUTH_FAILURE.test(message)) throw error;
        console.warn('[VoiceEngine] ElevenLabs TTS retrying after:', message);
        arrayBuffer = await requestAudio();
      }

      const bytes = new Uint8Array(arrayBuffer);
      console.log('[VoiceEngine] ElevenLabs: received', bytes.length, 'bytes');

      if (bytes.length === 0) {
        throw new Error('Empty audio response');
      }

      await this.usePlaybackAudioMode(true);

      // Encode to base64 using pure JS encoder (Hermes-safe, no btoa)
      const base64Audio = VoiceEngineService.toBase64(bytes);
      console.log('[VoiceEngine] ElevenLabs: base64 length:', base64Audio.length);

      // Write to temp file and play
      const audioFile = `${FileSystem.cacheDirectory}el_tts_${Date.now()}.mp3`;
      await FileSystem.writeAsStringAsync(audioFile, base64Audio, {
        encoding: FileSystem.EncodingType.Base64,
      });

      const fileInfo = await FileSystem.getInfoAsync(audioFile);
      console.log('[VoiceEngine] ElevenLabs: file size:', (fileInfo as { size?: number }).size);

      await this.stopSound();
      const { sound } = await Audio.Sound.createAsync(
        { uri: audioFile },
        { shouldPlay: true },
      );
      this.sound = sound;
      const playbackGeneration = this.playbackGeneration;
      console.log('[VoiceEngine] ElevenLabs: playing!');
      this.setState('speaking');

      sound.setOnPlaybackStatusUpdate((status) => {
        if ('didJustFinish' in status && status.didJustFinish) {
          sound.setOnPlaybackStatusUpdate(null);
          this.finalizeSoundPlayback(sound, audioFile, playbackGeneration).catch((error) => {
            console.warn('[VoiceEngine] Failed to finalize ElevenLabs playback:', error);
          });
        }
      });
    } catch (e: unknown) {
      const errMsg = e instanceof Error ? e.message : String(e);
      track('voice_tts_failed', { provider: 'elevenlabs', error_category: categorizeError(errMsg) });
      console.warn('[VoiceEngine] ElevenLabs TTS failed:', errMsg);
      const authFailed = ELEVENLABS_AUTH_FAILURE.test(errMsg);

      if (authFailed) {
        await SecureStore.deleteItemAsync(ELEVENLABS_KEY);
      }

      if (!this.elevenLabsFailShown) {
        this.elevenLabsFailShown = true;
        const { Alert } = require('react-native');
        Alert.alert(
          authFailed ? 'ElevenLabs Key Removed' : 'ElevenLabs TTS Error',
          authFailed
            ? 'Your ElevenLabs API key was rejected. I removed it and will use the system voice.'
            : `ElevenLabs voice failed, so I skipped pronunciation instead of using the robotic system voice.\n\nError: ${errMsg}`,
        );
      }

      if (authFailed) {
        await this.speakWithSystem(text);
        return;
      }

      await this.onSpeechDone();
    }
  }

  private async finalizeSoundPlayback(sound: Audio.Sound, audioFile: string, generation: number): Promise<void> {
    if (generation !== this.playbackGeneration) return;

    try {
      await sound.unloadAsync();
    } catch {
      // Sound may already be unloaded after an interruption or manual stop.
    }

    if (this.sound === sound) {
      this.sound = null;
    }

    await FileSystem.deleteAsync(audioFile, { idempotent: true }).catch(() => {});
    await this.onSpeechDone(generation);
  }

  private async onSpeechDone(generation = this.playbackGeneration): Promise<void> {
    if (generation !== this.playbackGeneration) return;

    const shouldResume = this.continuousMode;
    this.setState('idle');
    await this.usePlaybackAudioMode(false).catch(() => {});

    if (!shouldResume) return;

    this.clearPostTtsTimer();
    this.postTtsTimer = setTimeout(() => {
      if (generation !== this.playbackGeneration || !this.continuousMode || this._state !== 'idle') return;
      this.startListening(true).catch((e) => {
        console.warn('[VoiceEngine] Failed to resume listening:', e);
      });
    }, POST_TTS_COOLDOWN_MS);
  }

  async stopSpeaking(): Promise<void> {
    this.continuousMode = false;
    this.playbackGeneration += 1;
    this.clearPostTtsTimer();
    try {
      await this.stopTts();
      await this.stopSound();
    } catch {
      // Ignore
    }
    await this.usePlaybackAudioMode(false).catch(() => {});
    this.setState('idle');
  }

  async suspend(options: SuspendOptions = {}): Promise<void> {
    return this.enqueueOperation(async () => {
      this.continuousMode = false;
      this.clearListeningTimers();
      this.clearPostTtsTimer();
      this.latestTranscript = '';
      await this.finishElevenLabsRecording('cancel');
      if (!options.keepPlayback) {
        await this.stopTts();
        await this.stopSound();
      }
      await this.stopRecognition('cancel');
      if (
        !options.keepPlayback
        || (this._state !== 'speaking' && this._state !== 'preparingAudio')
      ) {
        this.setState('idle');
      }
    });
  }

  private async stopSound(): Promise<void> {
    if (this.sound) {
      try {
        await this.sound.stopAsync();
        await this.sound.unloadAsync();
      } catch {
        // Ignore
      }
      this.sound = null;
    }
  }

  private async stopTts(): Promise<void> {
    this.ttsCleanup?.();
    this.ttsCleanup = null;
    await this.stopNativeTts();
  }

  private async stopNativeTts(): Promise<void> {
    try {
      await Tts.stop(false);
    } catch {
      // Ignore
    }
  }

  private async prepareForPlayback(): Promise<void> {
    this.playbackGeneration += 1;
    this.clearListeningTimers();
    this.clearPostTtsTimer();
    this.latestTranscript = '';
    await this.finishElevenLabsRecording('cancel');
    await this.stopRecognition('cancel');
    await this.stopSound();
    await this.stopTts();
    await this.usePlaybackAudioMode(true);
  }

  private async useRecordingAudioMode(): Promise<void> {
    await Audio.setAudioModeAsync({
      allowsRecordingIOS: true,
      interruptionModeIOS: InterruptionModeIOS.DoNotMix,
      playsInSilentModeIOS: true,
      staysActiveInBackground: false,
    });
  }

  private async usePlaybackAudioMode(staysActiveInBackground: boolean): Promise<void> {
    await Audio.setAudioModeAsync({
      allowsRecordingIOS: false,
      interruptionModeIOS: InterruptionModeIOS.DuckOthers,
      playsInSilentModeIOS: true,
      staysActiveInBackground,
    });
  }

  setThinking(): void {
    this.setState('thinking');
  }

  async destroy(): Promise<void> {
    return this.enqueueOperation(async () => {
      this.clearListeningTimers();
      this.clearPostTtsTimer();
      this.continuousMode = false;
      this.latestTranscript = '';
      await this.finishElevenLabsRecording('cancel');
      try {
        await Voice.destroy();
      } catch {
        // Ignore
      }
      Voice.removeAllListeners();
      this.recognitionHandlersBound = false;
      await this.stopTts();
      await this.stopSound();
      this.recognizing = false;
      this.initialized = false;
      this.setState('idle');
    });
  }

  // --- Private ---

  private setState(state: VoiceState) {
    this._state = state;
    this.stateListeners.forEach((l) => l(state));
  }

  private setInputProvider(provider: VoiceInputProvider) {
    this._inputProvider = provider;
    this.inputProviderListeners.forEach((l) => l(provider));
  }

  private resetSilenceTimer(): void {
    this.clearSilenceTimer();
    this.silenceTimer = setTimeout(() => {
      this.handleSilenceTimeout();
    }, VoiceEngineService.SILENCE_TIMEOUT_MS);
  }

  private clearSilenceTimer(): void {
    if (this.silenceTimer) {
      clearTimeout(this.silenceTimer);
      this.silenceTimer = null;
    }
  }

  private clearNoSpeechTimer(): void {
    if (this.noSpeechTimer) {
      clearTimeout(this.noSpeechTimer);
      this.noSpeechTimer = null;
    }
  }

  private clearStuckListeningTimer(): void {
    if (this.stuckListeningTimer) {
      clearTimeout(this.stuckListeningTimer);
      this.stuckListeningTimer = null;
    }
  }

  private clearPostTtsTimer(): void {
    if (this.postTtsTimer) {
      clearTimeout(this.postTtsTimer);
      this.postTtsTimer = null;
    }
  }

  private clearListeningTimers(): void {
    this.clearSilenceTimer();
    this.clearNoSpeechTimer();
    this.clearStuckListeningTimer();
  }

  private resetListeningSession(): void {
    this.clearListeningTimers();
    this.speechStarted = false;
    this.lastSpeechActivityAt = 0;
    this.listeningStartedAt = Date.now();
    this.listeningGeneration += 1;
  }

  private markListeningStarted(): void {
    const generation = this.listeningGeneration;
    this.noSpeechTimer = setTimeout(() => {
      this.handleNoSpeechTimeout(generation).catch((error) => {
        console.warn('[VoiceEngine] Failed to handle no-speech timeout:', error);
      });
    }, NO_SPEECH_TIMEOUT_MS);
    this.scheduleStuckListeningGuard(generation);
  }

  private markSpeechActivity(): void {
    this.speechStarted = true;
    this.lastSpeechActivityAt = Date.now();
    this.clearNoSpeechTimer();
  }

  private scheduleStuckListeningGuard(generation = this.listeningGeneration): void {
    this.clearStuckListeningTimer();
    this.stuckListeningTimer = setTimeout(() => {
      this.handleStuckListeningGuard(generation).catch((error) => {
        console.warn('[VoiceEngine] Failed to recover stuck listener:', error);
      });
    }, STUCK_LISTENING_GUARD_MS);
  }

  private async handleNoSpeechTimeout(generation: number): Promise<void> {
    if (generation !== this.listeningGeneration || this._state !== 'listening' || this.speechStarted) return;

    this.continuousMode = false;
    this.latestTranscript = '';
    if (this.recordingProvider === 'elevenlabs' || this.recording) {
      await this.finishElevenLabsRecording('noSpeech');
      return;
    }
    await this.stopRecognition('cancel');
    this.clearListeningTimers();
    this.notifyError('I did not hear anything. Tap to try again.');
    if (this._state === 'listening' || this._state === 'thinking') {
      this.setState('idle');
    }
  }

  private async handleStuckListeningGuard(generation: number): Promise<void> {
    if (generation !== this.listeningGeneration || this._state !== 'listening') return;

    const recentSpeech = this.lastSpeechActivityAt > 0
      && Date.now() - this.lastSpeechActivityAt < ACTIVE_SPEECH_GRACE_MS;
    if (recentSpeech) {
      this.scheduleStuckListeningGuard(generation);
      return;
    }

    if (this.latestTranscript.trim()) {
      await this.finalizeCurrentTranscript('stuckGuard');
      return;
    }

    this.continuousMode = false;
    await this.finishElevenLabsRecording(this.speechStarted ? 'stuck' : 'noSpeech');
    await this.stopRecognition('cancel');
    this.clearListeningTimers();
    this.notifyError(
      this.speechStarted
        ? 'Microphone lost the end of your speech. Tap to try again.'
        : 'I did not hear clear speech. Tap to try again.',
    );
    if (this._state === 'listening' || this._state === 'thinking') {
      this.setState('idle');
    }
  }

  private async finalizeCurrentTranscript(reason: 'silence' | 'manual' | 'speechEnd' | 'stuckGuard'): Promise<void> {
    if (this._state !== 'listening' && reason !== 'manual') return;

    const finalText = this.latestTranscript.trim();
    this.latestTranscript = '';
    this.clearListeningTimers();

    if (finalText) {
      this.transcriptListeners.forEach((l) => l(finalText, true));
    }

    if (this.recordingProvider === 'elevenlabs' || this.recording) {
      await this.finishElevenLabsRecording(reason === 'manual' ? 'manual' : 'silence');
      return;
    }

    await this.stopRecognition('stop');
    if (this._state === 'listening') {
      this.setState('idle');
    }
  }

  private async handleSilenceTimeout(): Promise<void> {
    if (this._state !== 'listening') return;

    if (this.recordingProvider === 'elevenlabs' || this.recording) {
      await this.finishElevenLabsRecording('silence');
      return;
    }

    if (this.latestTranscript.trim()) {
      await this.finalizeCurrentTranscript('silence');
    }
  }

  private onSpeechResults(e: SpeechResultsEvent) {
    if (this._state !== 'listening') return;
    const text = e.value?.[0] || '';
    if (text) {
      this.latestTranscript = text;
      this.markSpeechActivity();
      this.transcriptListeners.forEach((l) => l(text, false));
      this.resetSilenceTimer();
    }
  }

  private onSpeechPartial(e: SpeechResultsEvent) {
    if (this._state !== 'listening') return;
    const text = e.value?.[0] || '';
    if (text) {
      this.latestTranscript = text;
      this.markSpeechActivity();
      this.transcriptListeners.forEach((l) => l(text, false));
      this.resetSilenceTimer();
    }
  }

  private onSpeechError(e: SpeechErrorEvent) {
    this.clearListeningTimers();
    this.recognizing = false;
    const code = (e.error as Record<string, unknown>)?.code ?? e.error;

    if (this.isAlreadyStartedError(e.error)) {
      console.log('[VoiceEngine] Native recognizer was already active; continuing current session.');
      this.recognizing = true;
      if (this._state !== 'listening') {
        this.setState('listening');
      }
      return;
    }

    console.warn('[VoiceEngine] Speech error:', code, e.error);
    this.notifyError(formatSpeechError(code));
    this.continuousMode = false;

    const elapsed = Date.now() - this.listeningStartedAt;
    if (elapsed < VoiceEngineService.MIN_LISTEN_MS) {
      console.log('[VoiceEngine] Ignoring early speech error.');
      if (this._state === 'listening') {
        this.setState('idle');
      }
      return;
    }

    if (this.latestTranscript.trim()) {
      this.finalizeCurrentTranscript('speechEnd').catch((error) => {
        console.warn('[VoiceEngine] Failed to finalize speech error transcript:', error);
      });
      return;
    }

    if (this._state === 'listening') {
      this.setState('idle');
    }
  }

  private onSpeechEnd() {
    this.clearListeningTimers();
    this.recognizing = false;
    const elapsed = Date.now() - this.listeningStartedAt;

    if (elapsed < VoiceEngineService.MIN_LISTEN_MS && !this.latestTranscript.trim()) {
      console.log('[VoiceEngine] Ignoring premature onSpeechEnd.');
      if (this._state === 'listening') {
        this.setState('idle');
      }
      return;
    }

    if (this.latestTranscript.trim()) {
      this.finalizeCurrentTranscript('speechEnd').catch((error) => {
        console.warn('[VoiceEngine] Failed to finalize speech transcript:', error);
      });
      return;
    }

    if (this._state === 'listening') {
      this.setState('idle');
    }
  }

  private enqueueOperation(operation: () => Promise<void>): Promise<void> {
    const next = this.operationQueue
      .catch(() => {})
      .then(operation);

    this.operationQueue = next.catch(() => {});
    return next;
  }

  private isAlreadyStartedError(error: unknown): boolean {
    const message = error instanceof Error
      ? error.message
      : typeof error === 'string'
        ? error
        : error && typeof error === 'object' && 'message' in error
          ? String((error as { message?: unknown }).message ?? '')
          : '';

    return message.toLowerCase().includes('speech recognition already started');
  }

  private notifyError(message: string): void {
    this.errorListeners.forEach((l) => l(message));
  }

  private async startElevenLabsRecording(): Promise<void> {
    const permission = await Audio.requestPermissionsAsync();
    if (!permission.granted) {
      throw new Error('Microphone permission is required.');
    }

    this.latestTranscript = '';
    this.recordingHeardSpeech = false;
    this.speechStarted = false;
    this.lastSpeechActivityAt = 0;
    this.recordingSilentSince = 0;
    this.transcriptionInProgress = false;

    try {
      const recording = new Audio.Recording();
      recording.setProgressUpdateInterval(250);
      recording.setOnRecordingStatusUpdate((status) => {
        this.handleElevenLabsRecordingStatus(status);
      });
      await recording.prepareToRecordAsync(Audio.RecordingOptionsPresets.HIGH_QUALITY);
      await recording.startAsync();
      this.recording = recording;
      this.recordingProvider = 'elevenlabs';
      this.setInputProvider('elevenlabs');
      if (!this.listeningStartedAt) {
        this.resetListeningSession();
      }
      this.markListeningStarted();
      this.setState('listening');
    } catch (error) {
      this.recording = null;
      this.recordingProvider = null;
      console.warn('[VoiceEngine] Failed to start ElevenLabs recording:', error);
      this.notifyError(formatAudioError(error));
      this.setState('idle');
    }
  }

  private handleElevenLabsRecordingStatus(status: RecordingStatus): void {
    if (!this.recording || this.recordingProvider !== 'elevenlabs' || this.transcriptionInProgress) return;
    if (!status.isRecording) return;

    const elapsed = status.durationMillis || (Date.now() - this.listeningStartedAt);
    const metering = typeof status.metering === 'number' ? status.metering : null;
    if (metering === null) {
      if (!this.recordingHeardSpeech && elapsed >= NO_SPEECH_TIMEOUT_MS) {
        this.enqueueOperation(() => this.finishElevenLabsRecording('noSpeech')).catch((error) => {
          console.warn('[VoiceEngine] Failed to finish quiet ElevenLabs recording:', error);
        });
      }
      return;
    }

    if (metering > VoiceEngineService.STT_SPEECH_THRESHOLD_DB) {
      this.recordingHeardSpeech = true;
      this.markSpeechActivity();
      this.recordingSilentSince = 0;
      return;
    }

    if (!this.recordingHeardSpeech && elapsed >= NO_SPEECH_TIMEOUT_MS) {
      this.enqueueOperation(() => this.finishElevenLabsRecording('noSpeech')).catch((error) => {
        console.warn('[VoiceEngine] Failed to finish no-speech ElevenLabs recording:', error);
      });
      return;
    }

    if (
      !this.recordingHeardSpeech
      || elapsed < VoiceEngineService.MIN_LISTEN_MS
      || metering > VoiceEngineService.STT_SILENCE_THRESHOLD_DB
    ) {
      return;
    }

    if (!this.recordingSilentSince) {
      this.recordingSilentSince = Date.now();
      return;
    }

    if (Date.now() - this.recordingSilentSince >= VoiceEngineService.SILENCE_TIMEOUT_MS) {
      this.enqueueOperation(() => this.finishElevenLabsRecording('silence')).catch((error) => {
        console.warn('[VoiceEngine] Failed to finish ElevenLabs recording:', error);
      });
    }
  }

  private async finishElevenLabsRecording(reason: 'cancel' | 'manual' | 'silence' | 'noSpeech' | 'stuck'): Promise<void> {
    const recording = this.recording;
    if (!recording || this.transcriptionInProgress) return;

    this.transcriptionInProgress = true;
    this.recording = null;
    this.recordingProvider = null;
    this.recordingSilentSince = 0;
    this.clearListeningTimers();

    recording.setOnRecordingStatusUpdate(null);
    const audioUri = recording.getURI();

    try {
      await recording.stopAndUnloadAsync();
    } catch (error) {
      console.warn('[VoiceEngine] Failed to stop ElevenLabs recording:', error);
    }

    if (
      reason === 'cancel'
      || reason === 'noSpeech'
      || reason === 'stuck'
      || Date.now() - this.listeningStartedAt < QUICK_MANUAL_STOP_MS
    ) {
      this.transcriptionInProgress = false;
      this.setState('idle');
      if (reason === 'noSpeech') {
        this.continuousMode = false;
        this.notifyError('I did not hear anything. Tap to try again.');
      } else if (reason === 'stuck') {
        this.continuousMode = false;
        this.notifyError('Microphone did not finish cleanly. Tap to try again.');
      }
      if (audioUri) {
        FileSystem.deleteAsync(audioUri, { idempotent: true }).catch(() => {});
      }
      return;
    }

    if (!audioUri) {
      this.transcriptionInProgress = false;
      this.notifyError('Could not read microphone recording.');
      this.setState('idle');
      return;
    }

    this.setState('thinking');
    try {
      const apiKey = await SecureStore.getItemAsync(ELEVENLABS_KEY);
      if (!apiKey?.trim()) {
        throw new ElevenLabsSpeechError('ElevenLabs API key is missing.');
      }

      const language = await getVoiceLanguage();
      const text = await transcribeWithElevenLabs(audioUri, apiKey, language.languageCode);
      if (text) {
        this.transcriptListeners.forEach((l) => l(text, true));
      } else {
        this.notifyError('I could not hear enough speech to transcribe.');
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'ElevenLabs transcription failed.';
      console.warn('[VoiceEngine] ElevenLabs STT failed:', message);

      if (error instanceof ElevenLabsSpeechError && error.authFailure) {
        await SecureStore.setItemAsync(ELEVENLABS_STT_ENABLED, 'false');
        const { Alert } = require('react-native');
        Alert.alert(
          'ElevenLabs Speech Disabled',
          'Your key was rejected for speech-to-text. I disabled ElevenLabs transcription and will use system dictation next time.',
        );
      }

      this.notifyError(message);
    } finally {
      this.transcriptionInProgress = false;
      this.setState('idle');
      FileSystem.deleteAsync(audioUri, { idempotent: true }).catch(() => {});
    }
  }

  private async stopRecognition(method: 'cancel' | 'stop'): Promise<void> {
    let isRecognizing = this.recognizing;

    try {
      isRecognizing = isRecognizing || Boolean(await Voice.isRecognizing());
    } catch {
      // Some native implementations throw when no recognizer is active.
    }

    if (!isRecognizing) {
      this.recognizing = false;
      return;
    }

    try {
      if (method === 'stop') {
        await Voice.stop();
      } else {
        await Voice.cancel();
      }
    } catch {
      // Stop/cancel can race native end events; the target state is still inactive.
    } finally {
      try {
        await Voice.destroy();
      } catch {
        // destroySpeech is the reliable iOS teardown path; ignore if already gone.
      }
      this.recognizing = false;
    }
  }
}

// Singleton
export const voiceEngine = new VoiceEngineService();
