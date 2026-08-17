import * as FileSystem from 'expo-file-system/legacy';
import type { ChatMessage } from '@/types/gateway';

const HISTORY_DIR = `${FileSystem.documentDirectory || ''}conversation-history`;
const DEFAULT_SESSION_KEY = 'main';
const MAX_MESSAGES_PER_SESSION = 200;

export async function loadConversationHistory(gatewayId: string, sessionKey = DEFAULT_SESSION_KEY): Promise<ChatMessage[]> {
  if (!gatewayId) return [];
  try {
    const raw = await FileSystem.readAsStringAsync(historyPath(gatewayId, sessionKey));
    const parsed = JSON.parse(raw) as ChatMessage[];
    return parsed.filter(isPersistableMessage).slice(-MAX_MESSAGES_PER_SESSION);
  } catch {
    return [];
  }
}

export async function saveConversationHistory(gatewayId: string, messages: ChatMessage[], sessionKey = DEFAULT_SESSION_KEY): Promise<void> {
  if (!gatewayId) return;
  await ensureHistoryDir();
  const persistable = messages
    .filter(isPersistableMessage)
    .slice(-MAX_MESSAGES_PER_SESSION)
    .map((message) => ({ ...message, streaming: false }));
  await FileSystem.writeAsStringAsync(historyPath(gatewayId, sessionKey), JSON.stringify(persistable));
}

export async function appendConversationMessage(gatewayId: string, message: ChatMessage, sessionKey = DEFAULT_SESSION_KEY): Promise<void> {
  if (!isPersistableMessage(message)) return;
  const existing = await loadConversationHistory(gatewayId, sessionKey);
  if (existing.some((item) => item.id === message.id)) return;
  await saveConversationHistory(gatewayId, [...existing, message], sessionKey);
}

/**
 * Keeps locally stored conversations reachable when duplicate gateway profiles
 * are consolidated. Source files are deliberately left in place: the profile
 * migration should never turn a storage cleanup into an irreversible delete.
 */
export async function mergeConversationHistories(targetGatewayId: string, sourceGatewayIds: string[]): Promise<void> {
  if (!targetGatewayId || sourceGatewayIds.length === 0) return;

  const histories = await Promise.all([
    loadConversationHistory(targetGatewayId),
    ...sourceGatewayIds
      .filter((gatewayId) => gatewayId && gatewayId !== targetGatewayId)
      .map((gatewayId) => loadConversationHistory(gatewayId)),
  ]);

  const seen = new Set<string>();
  const merged = histories
    .flat()
    .filter((message) => {
      const identity = message.id || `${message.role}\u0000${message.timestamp}\u0000${message.content}`;
      if (seen.has(identity)) return false;
      seen.add(identity);
      return true;
    })
    .sort((left, right) => left.timestamp - right.timestamp)
    .slice(-MAX_MESSAGES_PER_SESSION);

  if (merged.length > 0) {
    await saveConversationHistory(targetGatewayId, merged);
  }
}

export async function clearConversationHistory(gatewayId?: string, sessionKey = DEFAULT_SESSION_KEY): Promise<void> {
  if (!gatewayId) {
    await FileSystem.deleteAsync(HISTORY_DIR, { idempotent: true });
    return;
  }
  await FileSystem.deleteAsync(historyPath(gatewayId, sessionKey), { idempotent: true });
}

function historyPath(gatewayId: string, sessionKey: string): string {
  return `${HISTORY_DIR}/${safeFilePart(gatewayId)}-${safeFilePart(sessionKey)}.json`;
}

async function ensureHistoryDir(): Promise<void> {
  await FileSystem.makeDirectoryAsync(HISTORY_DIR, { intermediates: true }).catch(() => {});
}

function isPersistableMessage(message: ChatMessage): boolean {
  return Boolean(
    message
      && (message.role === 'user' || message.role === 'assistant')
      && typeof message.content === 'string'
      && message.content.trim()
      && typeof message.timestamp === 'number'
      && !message.streaming,
  );
}

function safeFilePart(value: string): string {
  return value.replace(/[^a-zA-Z0-9_.-]/g, '_').slice(0, 80);
}
