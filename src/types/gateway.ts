// OpenClaw Gateway Protocol v3 Types

export type FrameType = 'req' | 'res' | 'event';

export interface RequestFrame {
  type: 'req';
  id: string;
  method: string;
  params?: Record<string, unknown>;
}

export interface ResponseFrame {
  type: 'res';
  id: string;
  ok: boolean;
  payload?: Record<string, unknown>;
  error?: {
    code: string;
    message: string;
  };
}

export interface EventFrame {
  type: 'event';
  event: string;
  data?: Record<string, unknown>;
}

export type Frame = RequestFrame | ResponseFrame | EventFrame;

// Connect handshake
export interface ConnectParams {
  minProtocol: number;
  maxProtocol: number;
  client: {
    id: string;
    version: string;
    platform: 'ios' | 'android' | 'web';
    mode: 'node' | 'ui';
  };
  role: 'node' | 'operator';
  scopes: string[];
  caps: string[];
  commands: string[];
  permissions: Record<string, boolean>;
  auth: {
    token: string;
  };
  locale: string;
  userAgent: string;
  device: {
    id: string;
    publicKey: string;
    signature: string;
    signedAt: number;
    nonce: string;
  };
}

export interface HelloOkPayload {
  type: 'hello-ok';
  protocol: number;
  policy: {
    tickIntervalMs: number;
  };
  auth: {
    deviceToken: string;
    role: string;
    scopes: string[];
  };
}

// Chat
export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
  streaming?: boolean;
}

export interface ChatSendParams {
  message: string;
  sessionId?: string;
}

// Gateway status
export interface GatewayStatus {
  connected: boolean;
  protocol: number;
  uptime?: number;
  agent?: {
    model: string;
    status: string;
  };
}

// Connection state
export type ConnectionState = 'disconnected' | 'connecting' | 'connected' | 'reconnecting' | 'error';

// Gateway config stored in secure storage
export interface GatewayConfig {
  url: string;
  token: string;
  deviceToken?: string;
  name?: string;
}
