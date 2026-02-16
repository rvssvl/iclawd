import '@/polyfills';
import { Platform } from 'react-native';
import nacl from 'tweetnacl';
import { sha256 } from 'js-sha256';
import type {
  Frame,
  RequestFrame,
  ResponseFrame,
  EventFrame,
  ConnectParams,
  HelloOkPayload,
  ConnectionState,
  GatewayConfig,
  ChatMessage,
} from '@/types/gateway';
import { updateDeviceToken } from '@/services/SecureStorage';
import * as SecureStore from 'expo-secure-store';

const PROTOCOL_VERSION = 3;
const APP_VERSION = '2.0.0';
const RECONNECT_BASE_MS = 1000;
const RECONNECT_MAX_MS = 30000;
const TICK_DEFAULT_MS = 15000;

const KEY_DEVICE_ID = 'iclawd_device_id';
const KEY_KEYPAIR_PUBLIC = 'iclawd_keypair_pub';
const KEY_KEYPAIR_SECRET = 'iclawd_keypair_sec';

type ConnectionListener = (state: ConnectionState) => void;
type MessageListener = (message: ChatMessage) => void;
type StreamListener = (partialText: string, messageId: string) => void;

let idCounter = 0;
function nextId(): string {
  return `iclawd-${++idCounter}-${Date.now()}`;
}

// Base64URL encode/decode (OpenClaw uses base64url, not standard base64)
function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function fromBase64Url(str: string): Uint8Array {
  const normalized = str.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

// SHA-256 hash using js-sha256 (pure JS, works everywhere including Hermes)
function sha256Hex(data: Uint8Array): string {
  return sha256(data);
}

interface DeviceIdentity {
  id: string;        // SHA-256 hex of public key
  publicKey: string;  // base64url encoded
  secretKey: string;  // base64url encoded
}

async function getOrCreateDeviceIdentity(): Promise<DeviceIdentity> {
  const existingId = await SecureStore.getItemAsync(KEY_DEVICE_ID);
  const existingPub = await SecureStore.getItemAsync(KEY_KEYPAIR_PUBLIC);
  const existingSec = await SecureStore.getItemAsync(KEY_KEYPAIR_SECRET);

  if (existingId && existingPub && existingSec) {
    // Validate: recompute device ID from stored public key to ensure SHA-256 consistency
    const pubBytes = fromBase64Url(existingPub);
    const expectedId = sha256Hex(pubBytes);
    if (existingId === expectedId) {
      return { id: existingId, publicKey: existingPub, secretKey: existingSec };
    }
    // Mismatch — old identity used wrong hash, regenerate
    console.log('[Gateway] Regenerating device identity (hash mismatch)');
  }

  const keypair = nacl.sign.keyPair();
  const publicKey = toBase64Url(keypair.publicKey);
  const secretKey = toBase64Url(keypair.secretKey);

  // Device ID = full SHA-256 hex of public key (matches OpenClaw's fingerprintPublicKey)
  const deviceId = sha256Hex(keypair.publicKey);

  await SecureStore.setItemAsync(KEY_DEVICE_ID, deviceId);
  await SecureStore.setItemAsync(KEY_KEYPAIR_PUBLIC, publicKey);
  await SecureStore.setItemAsync(KEY_KEYPAIR_SECRET, secretKey);

  return { id: deviceId, publicKey, secretKey };
}

// Build the pipe-delimited payload that gets signed
// Format: v2|deviceId|clientId|clientMode|role|scopes|signedAtMs|token|nonce
function buildSignPayload(
  deviceId: string,
  clientId: string,
  clientMode: string,
  role: string,
  scopes: string[],
  signedAtMs: number,
  token: string,
  nonce: string,
): string {
  return [
    'v2',
    deviceId,
    clientId,
    clientMode,
    role,
    scopes.join(','),
    String(signedAtMs),
    token,
    nonce,
  ].join('|');
}

function signPayload(payload: string, secretKeyB64Url: string): string {
  const secretKey = fromBase64Url(secretKeyB64Url);
  const data = new TextEncoder().encode(payload);
  const sig = nacl.sign.detached(data, secretKey);
  return toBase64Url(sig);
}

// Extract origin from gateway URL for control-ui Origin header
function getOriginFromUrl(wsUrl: string): string {
  // wss://host:port/path → https://host:port
  // ws://host:port/path → http://host:port
  let url = wsUrl;
  if (url.startsWith('wss://')) {
    url = 'https://' + url.slice(6);
  } else if (url.startsWith('ws://')) {
    url = 'http://' + url.slice(5);
  }
  // Remove path
  try {
    const parsed = new URL(url);
    return parsed.origin;
  } catch {
    return url;
  }
}

export class GatewayClient {
  private ws: WebSocket | null = null;
  private config: GatewayConfig;
  private state: ConnectionState = 'disconnected';
  private reconnectAttempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private tickWatchTimer: ReturnType<typeof setTimeout> | null = null;
  private tickIntervalMs = TICK_DEFAULT_MS;
  private pendingRequests = new Map<string, {
    resolve: (payload: Record<string, unknown>) => void;
    reject: (error: Error) => void;
  }>();
  private connectionListeners = new Set<ConnectionListener>();
  private messageListeners = new Set<MessageListener>();
  private streamListeners = new Set<StreamListener>();
  private disposed = false;

  private connectResolve: (() => void) | null = null;
  private connectReject: ((err: Error) => void) | null = null;
  private connectRequestId: string | null = null;
  private deviceIdentity: DeviceIdentity | null = null;

  constructor(config: GatewayConfig) {
    this.config = config;
  }

  get connectionState(): ConnectionState {
    return this.state;
  }

  onConnectionChange(listener: ConnectionListener): () => void {
    this.connectionListeners.add(listener);
    return () => this.connectionListeners.delete(listener);
  }

  onMessage(listener: MessageListener): () => void {
    this.messageListeners.add(listener);
    return () => this.messageListeners.delete(listener);
  }

  onStream(listener: StreamListener): () => void {
    this.streamListeners.add(listener);
    return () => this.streamListeners.delete(listener);
  }

  async connect(): Promise<void> {
    if (this.disposed) return;
    this.setState('connecting');

    this.deviceIdentity = await getOrCreateDeviceIdentity();

    return new Promise((resolve, reject) => {
      try {
        this.connectResolve = resolve;
        this.connectReject = reject;
        // Set Origin header to gateway's own URL (required for control-ui auth)
        const origin = getOriginFromUrl(this.config.url);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        this.ws = new (WebSocket as any)(this.config.url, undefined, {
          headers: { Origin: origin },
        });

        const timeout = setTimeout(() => {
          this.connectResolve = null;
          this.connectReject = null;
          reject(new Error('Connection timeout'));
          this.ws?.close();
        }, 15000);

        const ws = this.ws!;

        ws.onopen = () => {
          // Don't send anything — wait for server's connect.challenge event
        };

        ws.onmessage = (event) => {
          this.handleFrame(event.data as string);
        };

        ws.onerror = () => {
          clearTimeout(timeout);
          if (this.connectReject) {
            this.connectReject(new Error('WebSocket error'));
            this.connectResolve = null;
            this.connectReject = null;
          }
        };

        ws.onclose = () => {
          clearTimeout(timeout);
          this.stopTickWatch();
          if (this.connectReject) {
            this.connectReject(new Error('Connection closed'));
            this.connectResolve = null;
            this.connectReject = null;
          }
          if (!this.disposed && this.state !== 'disconnected') {
            this.scheduleReconnect();
          }
        };
      } catch (err) {
        reject(err as Error);
      }
    });
  }

  disconnect(): void {
    this.disposed = true;
    this.stopTickWatch();
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.ws?.close();
    this.ws = null;
    this.setState('disconnected');
    this.pendingRequests.forEach(({ reject }) => reject(new Error('Disconnected')));
    this.pendingRequests.clear();
  }

  async sendChat(message: string, sessionKey?: string): Promise<void> {
    await this.rpc('chat.send', {
      message,
      sessionKey: sessionKey || 'main',
      idempotencyKey: `iclawd-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    });
  }

  async stopChat(): Promise<void> {
    await this.rpc('chat.stop', {});
  }

  async getStatus(): Promise<Record<string, unknown>> {
    return this.rpc('gateway.status', {});
  }

  async listSessions(): Promise<Record<string, unknown>> {
    return this.rpc('sessions.list', {});
  }

  // --- Private ---

  private handleChallengeAndConnect(challengeNonce: string): void {
    console.log('[Gateway] Challenge received, nonce:', challengeNonce.substring(0, 20) + '...');
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN || !this.deviceIdentity) return;

    const identity = this.deviceIdentity;
    console.log('[Gateway] Sending connect with device:', identity.id.substring(0, 16) + '...');
    const signedAtMs = Date.now();
    const clientId = 'openclaw-control-ui';
    const clientMode = 'ui';
    const role = 'operator';
    const scopes: string[] = ['operator.read', 'operator.write'];

    // Build pipe-delimited payload and sign it
    const payload = buildSignPayload(
      identity.id, clientId, clientMode, role, scopes,
      signedAtMs, this.config.token, challengeNonce,
    );
    const signature = signPayload(payload, identity.secretKey);

    const id = nextId();
    this.connectRequestId = id;

    const params: ConnectParams = {
      minProtocol: PROTOCOL_VERSION,
      maxProtocol: PROTOCOL_VERSION,
      client: {
        id: clientId,
        version: APP_VERSION,
        platform: 'web',
        mode: clientMode,
      },
      role,
      scopes,
      caps: ['voice'],
      commands: [],
      permissions: {},
      auth: { token: this.config.token },
      locale: 'en-US',
      userAgent: `iclawd/${APP_VERSION} (${Platform.OS})`,
      device: {
        id: identity.id,
        publicKey: identity.publicKey,
        signature,
        signedAt: signedAtMs,
        nonce: challengeNonce,
      },
    };

    const frame: RequestFrame = {
      type: 'req',
      id,
      method: 'connect',
      params: params as unknown as Record<string, unknown>,
    };

    this.ws.send(JSON.stringify(frame));
  }

  private async handleConnectResponse(frame: ResponseFrame): Promise<void> {
    console.log('[Gateway] Connect response:', JSON.stringify(frame).substring(0, 500));
    if (frame.ok) {
      const payload = frame.payload as unknown as HelloOkPayload;
      if (payload?.policy?.tickIntervalMs) {
        this.tickIntervalMs = payload.policy.tickIntervalMs;
      }
      if (payload?.auth?.deviceToken) {
        await updateDeviceToken(payload.auth.deviceToken);
      }
      this.setState('connected');
      this.reconnectAttempts = 0;
      this.startTickWatch();
      this.connectResolve?.();
    } else {
      const errMsg = frame.error?.message || 'Connection rejected';
      this.connectReject?.(new Error(errMsg));
    }
    this.connectResolve = null;
    this.connectReject = null;
    this.connectRequestId = null;
  }

  private async rpc(method: string, params: Record<string, unknown>): Promise<Record<string, unknown>> {
    return new Promise((resolve, reject) => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
        reject(new Error('Not connected'));
        return;
      }

      const id = nextId();
      const frame: RequestFrame = { type: 'req', id, method, params };

      const timeout = setTimeout(() => {
        this.pendingRequests.delete(id);
        reject(new Error(`RPC timeout: ${method}`));
      }, 15000);

      this.pendingRequests.set(id, {
        resolve: (p) => {
          clearTimeout(timeout);
          resolve(p);
        },
        reject: (err) => {
          clearTimeout(timeout);
          reject(err);
        },
      });

      this.ws.send(JSON.stringify(frame));
    });
  }

  private handleFrame(raw: string): void {
    let frame: Frame & { payload?: Record<string, unknown> };
    try {
      frame = JSON.parse(raw);
    } catch {
      return;
    }

    // Log non-tick frames for debugging
    if (frame.type === 'event') {
      const evtName = (frame as EventFrame).event;
      if (evtName !== 'health' && evtName !== 'tick' && evtName !== 'heartbeat') {
        console.log('[Gateway] Frame:', JSON.stringify(frame).substring(0, 300));
      }
    } else if (frame.type !== 'res') {
      console.log('[Gateway] Frame:', JSON.stringify(frame).substring(0, 200));
    }

    if (frame.type === 'res') {
      const resFrame = frame as ResponseFrame;
      if (this.connectRequestId && resFrame.id === this.connectRequestId) {
        this.handleConnectResponse(resFrame);
        return;
      }
      this.handleResponse(resFrame);
    } else if (frame.type === 'event') {
      const evtFrame = frame as EventFrame & { payload?: Record<string, unknown> };
      if (evtFrame.event === 'connect.challenge') {
        const payload = evtFrame.payload || evtFrame.data || {};
        const nonce = (payload.nonce as string) || '';
        this.handleChallengeAndConnect(nonce);
        return;
      }
      this.handleEvent(evtFrame);
    }
  }

  private handleResponse(frame: ResponseFrame): void {
    const pending = this.pendingRequests.get(frame.id);
    if (!pending) return;
    this.pendingRequests.delete(frame.id);

    if (frame.ok) {
      pending.resolve(frame.payload || {});
    } else {
      pending.reject(new Error(frame.error?.message || 'RPC error'));
    }
  }

  private handleEvent(frame: EventFrame): void {
    const payload = frame.data || (frame as unknown as { payload: Record<string, unknown> }).payload || {};

    // Tick events: reset the tick watch timer (server keepalive)
    if (frame.event === 'tick') {
      this.resetTickWatch();
      return;
    }

    // Skip other system events
    if (frame.event === 'health' || frame.event === 'heartbeat') {
      return;
    }

    console.log('[Gateway] Event:', frame.event, JSON.stringify(payload).substring(0, 300));

    switch (frame.event) {
      // Streaming text from agent
      case 'agent': {
        const stream = (payload.stream as string) || '';
        const data = (payload.data as Record<string, unknown>) || {};

        if (stream === 'assistant' && data.delta) {
          const delta = data.delta as string;
          const runId = (payload.runId as string) || '';
          this.streamListeners.forEach((l) => l(delta, runId));
        }

        if (stream === 'lifecycle' && data.phase === 'end') {
          // Agent finished — no action needed, chat final event handles it
        }
        break;
      }

      // Chat state events (delta + final)
      case 'chat': {
        const state = (payload.state as string) || '';
        const message = (payload.message as Record<string, unknown>) || {};

        if (state === 'final') {
          // Extract text from content array
          const content = (message.content as Array<{ type: string; text: string }>) || [];
          const text = content
            .filter((c) => c.type === 'text')
            .map((c) => c.text)
            .join('');

          const runId = (payload.runId as string) || nextId();
          if (text) {
            const msg: ChatMessage = {
              id: runId,
              role: 'assistant',
              content: text,
              timestamp: Date.now(),
            };
            this.messageListeners.forEach((l) => l(msg));
          }
        }
        break;
      }
    }
  }

  private setState(state: ConnectionState): void {
    this.state = state;
    this.connectionListeners.forEach((l) => l(state));
  }

  private scheduleReconnect(): void {
    if (this.disposed) return;
    this.setState('reconnecting');
    this.reconnectAttempts++;

    const delay = Math.min(
      RECONNECT_BASE_MS * Math.pow(2, this.reconnectAttempts - 1),
      RECONNECT_MAX_MS,
    );

    this.reconnectTimer = setTimeout(() => {
      this.connect().catch(() => {});
    }, delay);
  }

  // Listen for server tick events as keepalive. If no tick received within
  // 2x the interval, the connection is considered stale and we reconnect.
  private startTickWatch(): void {
    this.stopTickWatch();
    this.resetTickWatch();
  }

  private resetTickWatch(): void {
    this.stopTickWatch();
    this.tickWatchTimer = setTimeout(() => {
      console.warn('[Gateway] Tick timeout — no tick received in', 2 * this.tickIntervalMs, 'ms, reconnecting...');
      this.ws?.close(4000, 'tick timeout');
    }, 2 * this.tickIntervalMs);
  }

  private stopTickWatch(): void {
    if (this.tickWatchTimer) {
      clearTimeout(this.tickWatchTimer);
      this.tickWatchTimer = null;
    }
  }
}
