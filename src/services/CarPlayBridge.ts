import { NativeEventEmitter, NativeModules, Platform } from 'react-native';

export type CarPlayCommandAction = 'startVoice' | 'toggleVoice' | 'stopAudio' | 'pauseVoice';

export interface CarPlayCommand {
  action: CarPlayCommandAction;
  timestamp?: number;
}

export interface CarPlayStatus {
  state: 'ready' | 'connecting' | 'listening' | 'thinking' | 'speaking' | 'paused' | 'error';
  title: string;
  subtitle?: string;
}

type NativeCarPlayBridge = {
  setStatus?: (status: CarPlayStatus) => void;
};

const nativeBridge = Platform.OS === 'ios'
  ? (NativeModules.CarPlayBridge as NativeCarPlayBridge | undefined)
  : undefined;

const emitter = nativeBridge ? new NativeEventEmitter(NativeModules.CarPlayBridge) : null;

export function addCarPlayCommandListener(listener: (command: CarPlayCommand) => void) {
  if (!emitter) return () => {};

  const subscription = emitter.addListener('iClawdCarPlayCommand', listener);
  return () => subscription.remove();
}

export function setCarPlayStatus(status: CarPlayStatus) {
  nativeBridge?.setStatus?.(status);
}
