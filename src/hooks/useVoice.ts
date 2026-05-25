import { useEffect, useState, useCallback, useRef } from 'react';
import { voiceEngine, type VoiceInputProvider, type VoiceState } from '@/services/VoiceEngine';

export function useVoice() {
  const [voiceState, setVoiceState] = useState<VoiceState>('idle');
  const [inputProvider, setInputProvider] = useState<VoiceInputProvider>(voiceEngine.inputProvider);
  const [transcript, setTranscript] = useState('');
  const [lastError, setLastError] = useState<string | null>(null);
  const onFinalTranscriptRef = useRef<((text: string) => void) | null>(null);

  useEffect(() => {
    voiceEngine.init().catch((e) => {
      console.warn('[useVoice] Voice init failed:', e);
    });

    const unsubState = voiceEngine.onStateChange(setVoiceState);
    const unsubProvider = voiceEngine.onInputProviderChange(setInputProvider);
    const unsubTranscript = voiceEngine.onTranscript((text, isFinal) => {
      setTranscript(text);
      if (isFinal && text.trim()) {
        onFinalTranscriptRef.current?.(text.trim());
        setTranscript('');
      }
    });
    const unsubError = voiceEngine.onError(setLastError);

    return () => {
      unsubState();
      unsubProvider();
      unsubTranscript();
      unsubError();
    };
  }, []);

  const startListening = useCallback(async (continuous = false) => {
    setTranscript('');
    setLastError(null);
    try {
      await voiceEngine.startListening(continuous);
    } catch (e) {
      console.warn('[useVoice] Start listening failed:', e);
      setLastError(e instanceof Error ? e.message : 'Failed to start listening');
      throw e;
    }
  }, []);

  const stopListening = useCallback(async () => {
    try {
      await voiceEngine.stopListening();
    } catch (e) {
      console.warn('[useVoice] Stop listening failed:', e);
    }
  }, []);

  const speak = useCallback(async (text: string) => {
    try {
      await voiceEngine.speak(text);
    } catch (e) {
      console.warn('[useVoice] Speak failed:', e);
      throw e;
    }
  }, []);

  const stopSpeaking = useCallback(async () => {
    try {
      await voiceEngine.stopSpeaking();
    } catch (e) {
      console.warn('[useVoice] Stop speaking failed:', e);
    }
  }, []);

  const suspend = useCallback(async () => {
    try {
      await voiceEngine.suspend();
    } catch (e) {
      console.warn('[useVoice] Suspend failed:', e);
    }
  }, []);

  const setThinking = useCallback(() => {
    voiceEngine.setThinking();
  }, []);

  const setOnFinalTranscript = useCallback((cb: (text: string) => void) => {
    onFinalTranscriptRef.current = cb;
  }, []);

  return {
    voiceState,
    inputProvider,
    transcript,
    lastError,
    startListening,
    stopListening,
    speak,
    stopSpeaking,
    suspend,
    setThinking,
    setOnFinalTranscript,
  };
}
