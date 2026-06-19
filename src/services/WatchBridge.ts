import { NativeEventEmitter, NativeModules, Platform } from 'react-native';

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

type NativeWatchBridge = {
  setStatus?: (status: WatchStatus) => void;
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
