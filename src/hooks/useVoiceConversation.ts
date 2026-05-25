import { useCallback, useEffect, useReducer, useRef } from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import * as Haptics from 'expo-haptics';
import { useVoice } from '@/hooks/useVoice';
import type { ConnectionState } from '@/types/gateway';
import {
  getVoiceOrbState,
  initialVoiceConversationState,
  voiceConversationReducer,
} from '@/hooks/voiceConversationState';

interface Params {
  connectionState: ConnectionState;
  awaitingResponse: boolean;
  streamingText: string;
  latestAssistantId: string | null;
  sendMessage: (text: string) => Promise<void>;
  reconnect: () => Promise<void>;
}

export function useVoiceConversation({
  connectionState,
  awaitingResponse,
  streamingText,
  latestAssistantId,
  sendMessage,
  reconnect,
}: Params) {
  const [state, dispatch] = useReducer(voiceConversationReducer, initialVoiceConversationState);
  const {
    voiceState,
    transcript,
    lastError,
    startListening,
    stopListening,
    stopSpeaking,
    suspend,
    setOnFinalTranscript,
  } = useVoice();

  const stateRef = useRef(state);
  const latestAssistantIdRef = useRef(latestAssistantId);
  const inFlightUtteranceRef = useRef<string | null>(null);
  const lastSentUtteranceRef = useRef<{ text: string; at: number } | null>(null);
  stateRef.current = state;

  const pulse = useCallback((style: Haptics.ImpactFeedbackStyle) => {
    Haptics.impactAsync(style);
    setTimeout(() => {
      Haptics.selectionAsync();
    }, 70);
  }, []);

  useEffect(() => {
    dispatch({ type: 'TRANSCRIPT_PARTIAL', text: transcript });
  }, [transcript]);

  useEffect(() => {
    if (lastError) {
      dispatch({ type: 'AUDIO_ERROR', error: lastError });
    }
  }, [lastError]);

  useEffect(() => {
    setOnFinalTranscript(async (text) => {
      const utterance = text.trim();
      if (!utterance) return;

      const normalized = utterance.toLocaleLowerCase();
      const now = Date.now();
      const lastSent = lastSentUtteranceRef.current;
      if (
        inFlightUtteranceRef.current
        || (lastSent && lastSent.text === normalized && now - lastSent.at < 5000)
      ) {
        return;
      }

      inFlightUtteranceRef.current = normalized;
      lastSentUtteranceRef.current = { text: normalized, at: now };
      dispatch({ type: 'SEND_UTTERANCE' });
      try {
        await sendMessage(utterance);
        dispatch({ type: 'AGENT_STARTED' });
      } catch (error) {
        inFlightUtteranceRef.current = null;
        dispatch({
          type: 'AUDIO_ERROR',
          error: error instanceof Error ? error.message : 'Could not send voice message',
        });
      }
    });
  }, [sendMessage, setOnFinalTranscript]);

  useEffect(() => {
    if (awaitingResponse) {
      dispatch({ type: 'AGENT_STARTED' });
    }
  }, [awaitingResponse]);

  useEffect(() => {
    if (streamingText) {
      dispatch({ type: 'AGENT_STREAMING' });
    }
  }, [streamingText]);

  useEffect(() => {
    if (latestAssistantId && latestAssistantId !== latestAssistantIdRef.current) {
      latestAssistantIdRef.current = latestAssistantId;
      inFlightUtteranceRef.current = null;
      dispatch({ type: voiceState === 'speaking' ? 'TTS_STARTED' : 'AGENT_FINAL' });
    }
  }, [latestAssistantId, voiceState]);

  useEffect(() => {
    if (voiceState === 'listening') {
      dispatch({ type: 'MIC_READY' });
      dispatch({ type: 'TRANSCRIPT_PARTIAL', text: transcript });
    }
    if (voiceState === 'speaking') {
      dispatch({ type: 'TTS_STARTED' });
    }
    if (voiceState === 'idle' && stateRef.current.status === 'speaking') {
      dispatch({ type: 'TTS_DONE' });
    }
  }, [transcript, voiceState]);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (nextState: AppStateStatus) => {
      if (nextState === 'active') {
        dispatch({ type: 'FOREGROUND' });
        if (connectionState === 'disconnected') {
          reconnect();
        }
        return;
      }

      dispatch({ type: 'BACKGROUND' });
      suspend();
    });

    return () => sub.remove();
  }, [connectionState, reconnect, suspend]);

  useEffect(() => {
    const shouldListen =
      connectionState === 'connected'
      && state.foreground
      && state.status === 'starting'
      && voiceState === 'idle'
      && !awaitingResponse
      && !streamingText;

    if (shouldListen) {
      startListening(true).catch(() => {
        dispatch({ type: 'AUDIO_ERROR', error: 'Could not start microphone' });
      });
    }
  }, [awaitingResponse, connectionState, startListening, state.foreground, state.status, streamingText, voiceState]);

  useEffect(() => {
    if (
      connectionState !== 'connected'
      || !state.foreground
      || state.status !== 'recovering'
      || voiceState !== 'idle'
      || awaitingResponse
      || streamingText
    ) {
      return;
    }

    const timer = setTimeout(() => dispatch({ type: 'START_SESSION' }), 700);
    return () => clearTimeout(timer);
  }, [awaitingResponse, connectionState, state.foreground, state.status, streamingText, voiceState]);

  useEffect(() => {
    if (connectionState === 'connected' && state.status === 'paused' && state.foreground && state.sessionEnabled) {
      dispatch({ type: 'START_SESSION' });
    }
  }, [connectionState, state.foreground, state.sessionEnabled, state.status]);

  const toggleMic = useCallback(async () => {
    if (connectionState !== 'connected') {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      reconnect();
      return;
    }

    if (state.status === 'speaking' || voiceState === 'speaking' || voiceState === 'preparingAudio') {
      pulse(Haptics.ImpactFeedbackStyle.Medium);
      await stopSpeaking();
      dispatch({ type: 'TTS_DONE' });
      return;
    }

    if (state.status === 'starting') {
      pulse(Haptics.ImpactFeedbackStyle.Medium);
      dispatch({ type: 'PAUSE_MIC' });
      await suspend();
      return;
    }

    if (state.status === 'listening' || voiceState === 'listening') {
      pulse(Haptics.ImpactFeedbackStyle.Medium);
      const pendingTranscript = (state.transcript || transcript).trim();
      if (pendingTranscript) {
        dispatch({ type: 'SEND_UTTERANCE' });
        await stopListening();
        return;
      }

      dispatch({ type: 'PAUSE_MIC' });
      await suspend();
      return;
    }

    pulse(Haptics.ImpactFeedbackStyle.Heavy);
    dispatch({ type: 'RESUME_MIC' });
  }, [connectionState, pulse, reconnect, state.status, state.transcript, stopListening, stopSpeaking, suspend, transcript, voiceState]);

  useEffect(() => {
    if (state.status !== 'starting') return;

    const timer = setTimeout(() => {
      if (stateRef.current.status !== 'starting') return;
      dispatch({ type: 'PAUSE_MIC' });
      suspend();
    }, 4500);

    return () => clearTimeout(timer);
  }, [state.status, suspend]);

  const pause = useCallback(async () => {
    dispatch({ type: 'PAUSE_MIC' });
    await suspend();
  }, [suspend]);

  const statusLabel = (() => {
    switch (state.status) {
      case 'paused':
        return connectionState === 'connected' ? 'Paused. Tap to resume.' : 'Tap to reconnect';
      case 'starting':
        return 'Starting microphone...';
      case 'listening':
        return (state.transcript || transcript).trim()
          ? 'Tap to send.'
          : 'Listening. Pause when needed.';
      case 'finalizing':
        return 'Sending...';
      case 'awaitingAgent':
        return 'Waiting for response...';
      case 'agentStreaming':
        return 'Agent is responding...';
      case 'speaking':
        return 'Playing audio. Tap to stop.';
      case 'recovering':
        return voiceState === 'preparingAudio'
          ? 'Preparing audio...'
          : voiceState === 'speaking'
          ? 'Playing audio. Tap to stop.'
          : 'Listening will resume...';
      case 'error':
        return state.error || 'Microphone unavailable';
      default:
        return undefined;
    }
  })();

  return {
    conversationState: state,
    orbState: getVoiceOrbState(state.status, voiceState),
    transcript: state.transcript || transcript,
    statusLabel,
    toggleMic,
    pause,
    isBusy: state.status === 'finalizing',
  };
}
