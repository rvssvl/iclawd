import Voice, {
  SpeechResultsEvent,
  SpeechErrorEvent,
} from '@react-native-voice/voice';
import * as Speech from 'expo-speech';
import { Audio } from 'expo-av';
import * as FileSystem from 'expo-file-system';
import * as SecureStore from 'expo-secure-store';

export type VoiceState = 'idle' | 'listening' | 'thinking' | 'speaking';

type StateListener = (state: VoiceState) => void;
type TranscriptListener = (text: string, isFinal: boolean) => void;

const ELEVENLABS_KEY = 'iclawd_elevenlabs_key';
const ELEVENLABS_VOICE_ID = 'JBFqnCBsd6RMkjVDRZzb'; // George
const ELEVENLABS_MODEL = 'eleven_flash_v2_5';

class VoiceEngineService {
  private stateListeners = new Set<StateListener>();
  private transcriptListeners = new Set<TranscriptListener>();
  private _state: VoiceState = 'idle';
  private initialized = false;
  private latestTranscript = '';
  private listeningStartedAt = 0;
  private static MIN_LISTEN_MS = 800;
  private sound: Audio.Sound | null = null;
  private continuousMode = false;
  private silenceTimer: ReturnType<typeof setTimeout> | null = null;
  private static SILENCE_TIMEOUT_MS = 1500;

  get state(): VoiceState {
    return this._state;
  }

  async init(): Promise<void> {
    if (this.initialized) return;

    Voice.onSpeechResults = this.onSpeechResults.bind(this);
    Voice.onSpeechPartialResults = this.onSpeechPartial.bind(this);
    Voice.onSpeechError = this.onSpeechError.bind(this);
    Voice.onSpeechEnd = this.onSpeechEnd.bind(this);

    // Configure audio session for playback + recording
    await Audio.setAudioModeAsync({
      allowsRecordingIOS: true,
      playsInSilentModeIOS: true,
      staysActiveInBackground: false,
    });

    this.initialized = true;
  }

  onStateChange(listener: StateListener): () => void {
    this.stateListeners.add(listener);
    return () => this.stateListeners.delete(listener);
  }

  onTranscript(listener: TranscriptListener): () => void {
    this.transcriptListeners.add(listener);
    return () => this.transcriptListeners.delete(listener);
  }

  async startListening(continuous = false): Promise<void> {
    await this.init();
    this.continuousMode = continuous;
    this.clearSilenceTimer();
    await this.stopSound();
    Speech.stop();
    this.latestTranscript = '';
    this.listeningStartedAt = Date.now();
    this.setState('listening');
    try {
      await Voice.start('en-US');
    } catch (e) {
      console.warn('[VoiceEngine] Failed to start listening:', e);
      this.setState('idle');
    }
  }

  async stopListening(): Promise<void> {
    this.continuousMode = false;
    this.clearSilenceTimer();
    try {
      await Voice.stop();
    } catch {
      // Ignore
    }
  }

  async speak(text: string): Promise<void> {
    await this.init();
    this.setState('speaking');

    const elevenLabsKey = await SecureStore.getItemAsync(ELEVENLABS_KEY);
    console.log('[VoiceEngine] speak() — ElevenLabs:', elevenLabsKey ? 'configured' : 'not set');
    if (elevenLabsKey) {
      await this.speakWithElevenLabs(text, elevenLabsKey);
    } else {
      this.speakWithSystem(text);
    }
  }

  private speakWithSystem(text: string): void {
    Speech.speak(text, {
      language: 'en-US',
      rate: 0.9,
      pitch: 1.0,
      onStart: () => this.setState('speaking'),
      onDone: () => this.onSpeechDone(),
      onStopped: () => this.onSpeechDone(),
      onError: () => this.onSpeechDone(),
    });
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

      // Use XHR with arraybuffer responseType — most reliable binary method in RN Hermes
      const arrayBuffer = await new Promise<ArrayBuffer>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open('POST', `https://api.elevenlabs.io/v1/text-to-speech/${ELEVENLABS_VOICE_ID}`);
        xhr.setRequestHeader('xi-api-key', apiKey);
        xhr.setRequestHeader('Content-Type', 'application/json');
        xhr.responseType = 'arraybuffer';
        xhr.timeout = 15000;

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
          voice_settings: { stability: 0.5, similarity_boost: 0.75 },
        }));
      });

      const bytes = new Uint8Array(arrayBuffer);
      console.log('[VoiceEngine] ElevenLabs: received', bytes.length, 'bytes');

      if (bytes.length === 0) {
        throw new Error('Empty audio response');
      }

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
      console.log('[VoiceEngine] ElevenLabs: playing!');

      sound.setOnPlaybackStatusUpdate((status) => {
        if ('didJustFinish' in status && status.didJustFinish) {
          FileSystem.deleteAsync(audioFile, { idempotent: true }).catch(() => {});
          this.onSpeechDone();
        }
      });
    } catch (e: unknown) {
      const errMsg = e instanceof Error ? e.message : String(e);
      console.warn('[VoiceEngine] ElevenLabs TTS failed:', errMsg);

      if (!this.elevenLabsFailShown) {
        this.elevenLabsFailShown = true;
        const { Alert } = require('react-native');
        Alert.alert('ElevenLabs TTS Error', `Falling back to system voice.\n\nError: ${errMsg}`);
      }

      this.speakWithSystem(text);
    }
  }

  private onSpeechDone(): void {
    if (this.continuousMode) {
      // Resume listening after response
      this.startListening(true);
    } else {
      this.setState('idle');
    }
  }

  async stopSpeaking(): Promise<void> {
    const wasContinuous = this.continuousMode;
    try {
      Speech.stop();
      await this.stopSound();
    } catch {
      // Ignore
    }
    // If in continuous mode, resume listening instead of going idle
    if (wasContinuous) {
      this.startListening(true);
    } else {
      this.setState('idle');
    }
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

  setThinking(): void {
    this.setState('thinking');
  }

  async destroy(): Promise<void> {
    this.clearSilenceTimer();
    await Voice.destroy();
    Speech.stop();
    await this.stopSound();
    this.initialized = false;
    this.continuousMode = false;
    this.setState('idle');
  }

  // --- Private ---

  private setState(state: VoiceState) {
    this._state = state;
    this.stateListeners.forEach((l) => l(state));
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

  private async handleSilenceTimeout(): Promise<void> {
    if (this._state !== 'listening') return;

    if (this.latestTranscript.trim()) {
      const finalText = this.latestTranscript;
      this.latestTranscript = '';
      this.transcriptListeners.forEach((l) => l(finalText, true));

      // Stop the recognition session
      try {
        await Voice.stop();
      } catch {
        // Ignore
      }
    }
  }

  private onSpeechResults(e: SpeechResultsEvent) {
    if (this._state !== 'listening') return;
    const text = e.value?.[0] || '';
    if (text) {
      this.latestTranscript = text;
      this.transcriptListeners.forEach((l) => l(text, false));
      this.resetSilenceTimer();
    }
  }

  private onSpeechPartial(e: SpeechResultsEvent) {
    if (this._state !== 'listening') return;
    const text = e.value?.[0] || '';
    if (text) {
      this.latestTranscript = text;
      this.transcriptListeners.forEach((l) => l(text, false));
      this.resetSilenceTimer();
    }
  }

  private onSpeechError(e: SpeechErrorEvent) {
    this.clearSilenceTimer();
    const code = (e.error as Record<string, unknown>)?.code ?? e.error;
    console.warn('[VoiceEngine] Speech error:', code, e.error);

    const elapsed = Date.now() - this.listeningStartedAt;
    if (elapsed < VoiceEngineService.MIN_LISTEN_MS) {
      console.log('[VoiceEngine] Ignoring early speech error, restarting...');
      setTimeout(async () => {
        if (this._state === 'listening') {
          try {
            await Voice.start('en-US');
          } catch {
            this.setState('idle');
          }
        }
      }, 100);
      return;
    }

    if (this.latestTranscript.trim()) {
      const finalText = this.latestTranscript;
      this.latestTranscript = '';
      this.transcriptListeners.forEach((l) => l(finalText, true));
    } else if (this.continuousMode && this._state === 'listening') {
      // No speech detected but in continuous mode — restart
      setTimeout(async () => {
        if (this._state === 'listening') {
          try {
            this.listeningStartedAt = Date.now();
            await Voice.start('en-US');
          } catch {
            this.setState('idle');
          }
        }
      }, 200);
      return;
    }

    if (this._state === 'listening') {
      this.setState('idle');
    }
  }

  private onSpeechEnd() {
    this.clearSilenceTimer();
    const elapsed = Date.now() - this.listeningStartedAt;

    if (elapsed < VoiceEngineService.MIN_LISTEN_MS && !this.latestTranscript.trim()) {
      console.log('[VoiceEngine] Ignoring premature onSpeechEnd, restarting...');
      setTimeout(async () => {
        if (this._state === 'listening') {
          try {
            await Voice.start('en-US');
          } catch {
            this.setState('idle');
          }
        }
      }, 100);
      return;
    }

    if (this.latestTranscript.trim()) {
      const finalText = this.latestTranscript;
      this.latestTranscript = '';
      this.transcriptListeners.forEach((l) => l(finalText, true));
      // In continuous mode, don't go idle — we'll resume after thinking/speaking
    } else if (this.continuousMode && this._state === 'listening') {
      // No speech detected in continuous mode — restart listening
      setTimeout(async () => {
        if (this._state === 'listening') {
          try {
            this.listeningStartedAt = Date.now();
            await Voice.start('en-US');
          } catch {
            this.setState('idle');
          }
        }
      }, 200);
      return;
    }

    if (this._state === 'listening' && !this.continuousMode) {
      this.setState('idle');
    }
  }
}

// Singleton
export const voiceEngine = new VoiceEngineService();
