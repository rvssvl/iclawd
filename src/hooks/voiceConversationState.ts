import type { VoiceState } from '@/services/VoiceEngine';

export type VoiceConversationStatus =
  | 'paused'
  | 'starting'
  | 'listening'
  | 'finalizing'
  | 'awaitingAgent'
  | 'agentStreaming'
  | 'speaking'
  | 'recovering'
  | 'error';

export interface VoiceConversationState {
  status: VoiceConversationStatus;
  transcript: string;
  error: string | null;
  foreground: boolean;
  sessionEnabled: boolean;
}

export type VoiceConversationAction =
  | { type: 'START_SESSION' }
  | { type: 'PAUSE_MIC' }
  | { type: 'RESUME_MIC' }
  | { type: 'MIC_READY' }
  | { type: 'TRANSCRIPT_PARTIAL'; text: string }
  | { type: 'SEND_UTTERANCE' }
  | { type: 'AGENT_STARTED' }
  | { type: 'AGENT_STREAMING' }
  | { type: 'AGENT_FINAL' }
  | { type: 'TTS_STARTED' }
  | { type: 'TTS_DONE' }
  | { type: 'BACKGROUND' }
  | { type: 'FOREGROUND' }
  | { type: 'AUDIO_ERROR'; error: string };

export const initialVoiceConversationState: VoiceConversationState = {
  status: 'paused',
  transcript: '',
  error: null,
  foreground: true,
  sessionEnabled: false,
};

export function voiceConversationReducer(
  state: VoiceConversationState,
  action: VoiceConversationAction,
): VoiceConversationState {
  switch (action.type) {
    case 'START_SESSION':
    case 'RESUME_MIC':
      return { ...state, status: 'starting', sessionEnabled: true, error: null };
    case 'MIC_READY':
      return { ...state, status: 'listening', error: null };
    case 'PAUSE_MIC':
      return { ...state, status: 'paused', sessionEnabled: false, transcript: '', error: null };
    case 'TRANSCRIPT_PARTIAL':
      return { ...state, transcript: action.text };
    case 'SEND_UTTERANCE':
      return { ...state, status: 'finalizing', transcript: '', error: null };
    case 'AGENT_STARTED':
      return { ...state, status: 'awaitingAgent', error: null };
    case 'AGENT_STREAMING':
      return { ...state, status: 'agentStreaming', error: null };
    case 'AGENT_FINAL':
      return state.status === 'speaking'
        ? state
        : { ...state, status: state.foreground && state.sessionEnabled ? 'recovering' : 'paused', error: null };
    case 'TTS_STARTED':
      return { ...state, status: 'speaking', error: null };
    case 'TTS_DONE':
      return { ...state, status: state.foreground && state.sessionEnabled ? 'starting' : 'paused', error: null };
    case 'BACKGROUND':
      return { ...state, status: 'paused', foreground: false, sessionEnabled: false, transcript: '' };
    case 'FOREGROUND':
      return { ...state, foreground: true };
    case 'AUDIO_ERROR':
      return { ...state, status: 'error', sessionEnabled: false, error: action.error, transcript: '' };
    default:
      return state;
  }
}

export function getVoiceOrbState(status: VoiceConversationStatus, voiceState: VoiceState): VoiceState {
  if (voiceState === 'thinking' || voiceState === 'preparingAudio') return 'thinking';
  if (voiceState === 'speaking' || status === 'speaking') return 'speaking';
  if (status === 'listening' || status === 'starting') return 'listening';
  return 'idle';
}
