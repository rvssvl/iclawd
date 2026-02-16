import { useEffect, useState, useCallback, useRef } from 'react';
import { voiceEngine, type VoiceState } from '@/services/VoiceEngine';

export function useVoice() {
  const [voiceState, setVoiceState] = useState<VoiceState>('idle');
  const [transcript, setTranscript] = useState('');
  const onFinalTranscriptRef = useRef<((text: string) => void) | null>(null);

  useEffect(() => {
    voiceEngine.init();

    const unsubState = voiceEngine.onStateChange(setVoiceState);
    const unsubTranscript = voiceEngine.onTranscript((text, isFinal) => {
      setTranscript(text);
      if (isFinal && text.trim()) {
        onFinalTranscriptRef.current?.(text.trim());
        setTranscript('');
      }
    });

    return () => {
      unsubState();
      unsubTranscript();
    };
  }, []);

  const startListening = useCallback(async (continuous = false) => {
    setTranscript('');
    await voiceEngine.startListening(continuous);
  }, []);

  const stopListening = useCallback(async () => {
    await voiceEngine.stopListening();
  }, []);

  const speak = useCallback(async (text: string) => {
    await voiceEngine.speak(text);
  }, []);

  const stopSpeaking = useCallback(async () => {
    await voiceEngine.stopSpeaking();
  }, []);

  const setThinking = useCallback(() => {
    voiceEngine.setThinking();
  }, []);

  const setOnFinalTranscript = useCallback((cb: (text: string) => void) => {
    onFinalTranscriptRef.current = cb;
  }, []);

  return {
    voiceState,
    transcript,
    startListening,
    stopListening,
    speak,
    stopSpeaking,
    setThinking,
    setOnFinalTranscript,
  };
}
