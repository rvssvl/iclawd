import type { GatewayBackend } from '@/types/gateway';

export interface GatewayPairingPayload {
  backend: GatewayBackend;
  url: string;
  token: string;
  name?: string;
}

export function parseGatewayPairingPayload(rawValue: string): GatewayPairingPayload {
  const value = rawValue.trim();
  if (!value) throw new Error('QR code is empty.');

  if (value.startsWith('{')) {
    return parseGatewayPairingJson(value);
  }

  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error('QR code is not a ClawVoice gateway link.');
  }

  if (parsed.protocol !== 'clawvoice:' && parsed.protocol !== 'iclawd:') {
    throw new Error('QR code is not a ClawVoice gateway link.');
  }

  const hostAction = parsed.hostname || parsed.pathname.replace('/', '');
  if (hostAction && hostAction !== 'connect') {
    throw new Error('QR code is not a gateway pairing link.');
  }

  return normalizePairing({
    backend: parseBackend(parsed.searchParams.get('backend')),
    url: parsed.searchParams.get('url') || '',
    token: parsed.searchParams.get('token') || '',
    name: parsed.searchParams.get('name') || undefined,
  });
}

export function describePairingTarget(payload: GatewayPairingPayload): string {
  try {
    return new URL(payload.url).host || payload.url;
  } catch {
    return payload.url.replace(/^wss?:\/\//, '').split('/')[0];
  }
}

function parseGatewayPairingJson(value: string): GatewayPairingPayload {
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(value) as Record<string, unknown>;
  } catch {
    throw new Error('QR code contains invalid JSON.');
  }

  if (parsed.type !== 'clawvoice.gateway.v1') {
    throw new Error('QR code is not a ClawVoice gateway payload.');
  }

  return normalizePairing({
    backend: parseBackend(parsed.backend),
    url: typeof parsed.url === 'string' ? parsed.url : '',
    token: typeof parsed.token === 'string' ? parsed.token : '',
    name: typeof parsed.name === 'string' ? parsed.name : undefined,
  });
}

function normalizePairing(payload: GatewayPairingPayload): GatewayPairingPayload {
  const url = normalizeGatewayUrl(payload.url);
  const token = payload.token.trim();
  if (!url) throw new Error('QR code is missing a gateway URL.');
  if (!token) throw new Error('QR code is missing an auth token.');
  if (payload.backend !== 'openclaw') {
    throw new Error('This build only supports OpenClaw gateway QR codes.');
  }

  return {
    backend: payload.backend,
    url,
    token,
    name: payload.name?.trim() || undefined,
  };
}

function parseBackend(value: unknown): GatewayBackend {
  return value === 'hermes' ? 'hermes' : 'openclaw';
}

export function normalizeGatewayUrl(rawUrl: string): string {
  const url = rawUrl.trim();
  if (!url) return '';
  if (/^http:\/\//i.test(url)) return url.replace(/^http:\/\//i, 'ws://');
  if (/^https:\/\//i.test(url)) return url.replace(/^https:\/\//i, 'wss://');
  if (/^ws:\/\//i.test(url) || /^wss:\/\//i.test(url)) return normalizeWebSocketScheme(url);
  return `${shouldDefaultToPlainWebSocket(url) ? 'ws' : 'wss'}://${url}`;
}

function shouldDefaultToPlainWebSocket(urlWithoutScheme: string): boolean {
  const host = urlWithoutScheme.split('/')[0].split(':')[0].toLowerCase();
  return host === 'localhost'
    || host === '127.0.0.1'
    || host === '0.0.0.0'
    || host === '::1'
    || host === '[::1]'
    || /^\d{1,3}(?:\.\d{1,3}){3}$/.test(host)
    || host.endsWith('.local')
    || !host.includes('.');
}

function normalizeWebSocketScheme(url: string): string {
  return url.replace(/^ws:\/\//i, 'ws://').replace(/^wss:\/\//i, 'wss://');
}
