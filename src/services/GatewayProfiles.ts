import * as SecureStore from '@/services/SafeSecureStore';
import { mergeConversationHistories } from '@/services/ConversationHistory';
import type { GatewayBackend, GatewayConfig, GatewayProfile } from '@/types/gateway';

const LEGACY_GATEWAY_CONFIG_KEY = 'iclawd_gateway_config';
const GATEWAY_PROFILES_KEY = 'clawvoice_gateway_profiles';
const ACTIVE_GATEWAY_ID_KEY = 'clawvoice_active_gateway_id';

export interface GatewayProfileInput {
  backend?: GatewayBackend;
  name?: string;
  url: string;
  token: string;
  deviceToken?: string;
}

export async function getGatewayProfiles(): Promise<GatewayProfile[]> {
  await migrateLegacyGatewayIfNeeded();
  const raw = await SecureStore.getItemAsync(GATEWAY_PROFILES_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as GatewayProfile[];
    const profiles = parsed.filter(isGatewayProfile);
    return collapseDuplicateGatewayProfiles(profiles);
  } catch {
    return [];
  }
}

export async function getActiveGatewayProfile(): Promise<GatewayProfile | null> {
  const profiles = await getGatewayProfiles();
  if (profiles.length === 0) return null;

  const activeId = await SecureStore.getItemAsync(ACTIVE_GATEWAY_ID_KEY);
  return profiles.find((profile) => profile.id === activeId) || profiles[0] || null;
}

export async function getActiveGatewayId(): Promise<string | null> {
  const profile = await getActiveGatewayProfile();
  return profile?.id || null;
}

export async function saveGatewayProfile(input: GatewayProfileInput, options: { activate?: boolean; id?: string } = {}): Promise<GatewayProfile> {
  const profiles = await getGatewayProfiles();
  const now = Date.now();
  const requestedId = options.id?.trim();
  const existingIndexById = requestedId
    ? profiles.findIndex((profile) => profile.id === requestedId)
    : -1;
  // A gateway's address and auth token are its stable identity. This protects
  // against old callers that save a refreshed device token without an id, and
  // also prevents pairing the identical gateway from creating another row.
  const existingIndex = existingIndexById >= 0
    ? existingIndexById
    : profiles.findIndex((profile) => isSameGateway(profile, input));
  const existing = existingIndex >= 0 ? profiles[existingIndex] : null;
  const profile: GatewayProfile = {
    id: existing?.id || createGatewayProfileId(),
    backend: input.backend || existing?.backend || 'openclaw',
    name: input.name?.trim() || existing?.name || defaultGatewayName(input.url),
    url: input.url,
    token: input.token,
    deviceToken: input.deviceToken ?? existing?.deviceToken,
    createdAt: existing?.createdAt || now,
    lastConnectedAt: existing?.lastConnectedAt,
  };

  const nextProfiles = [...profiles];
  if (existingIndex >= 0) {
    nextProfiles[existingIndex] = profile;
  } else {
    nextProfiles.push(profile);
  }

  await saveGatewayProfiles(nextProfiles);
  if (options.activate !== false) {
    await setActiveGatewayProfile(profile.id);
  }
  return profile;
}

export async function setActiveGatewayProfile(profileId: string): Promise<void> {
  const profiles = await getGatewayProfiles();
  if (!profiles.some((profile) => profile.id === profileId)) return;
  await SecureStore.setItemAsync(ACTIVE_GATEWAY_ID_KEY, profileId);
}

export async function deleteGatewayProfile(profileId: string): Promise<void> {
  const profiles = await getGatewayProfiles();
  const nextProfiles = profiles.filter((profile) => profile.id !== profileId);
  await saveGatewayProfiles(nextProfiles);

  const activeId = await SecureStore.getItemAsync(ACTIVE_GATEWAY_ID_KEY);
  if (activeId === profileId) {
    if (nextProfiles[0]) {
      await SecureStore.setItemAsync(ACTIVE_GATEWAY_ID_KEY, nextProfiles[0].id);
    } else {
      await SecureStore.deleteItemAsync(ACTIVE_GATEWAY_ID_KEY);
    }
  }
}

export async function renameGatewayProfile(profileId: string, name: string): Promise<void> {
  const profiles = await getGatewayProfiles();
  await saveGatewayProfiles(profiles.map((profile) => (
    profile.id === profileId ? { ...profile, name: name.trim() || profile.name } : profile
  )));
}

export async function markGatewayProfileConnected(profileId: string): Promise<void> {
  const profiles = await getGatewayProfiles();
  await saveGatewayProfiles(profiles.map((profile) => (
    profile.id === profileId ? { ...profile, lastConnectedAt: Date.now() } : profile
  )));
}

export async function updateActiveGatewayDeviceToken(deviceToken: string): Promise<void> {
  const active = await getActiveGatewayProfile();
  if (!active) return;
  const profiles = await getGatewayProfiles();
  await saveGatewayProfiles(profiles.map((profile) => (
    profile.id === active.id ? { ...profile, deviceToken } : profile
  )));
}

export function gatewayProfileToConfig(profile: GatewayProfile): GatewayConfig {
  return {
    url: profile.url,
    token: profile.token,
    deviceToken: profile.deviceToken,
    name: profile.name,
  };
}

function saveGatewayProfiles(profiles: GatewayProfile[]): Promise<void> {
  return SecureStore.setItemAsync(GATEWAY_PROFILES_KEY, JSON.stringify(profiles));
}

async function migrateLegacyGatewayIfNeeded(): Promise<void> {
  const profilesRaw = await SecureStore.getItemAsync(GATEWAY_PROFILES_KEY);
  if (profilesRaw) return;

  const legacyRaw = await SecureStore.getItemAsync(LEGACY_GATEWAY_CONFIG_KEY);
  if (!legacyRaw) return;

  try {
    const legacy = JSON.parse(legacyRaw) as GatewayConfig;
    if (!legacy.url || !legacy.token) return;
    const profile: GatewayProfile = {
      id: createGatewayProfileId(),
      backend: 'openclaw',
      name: legacy.name || 'My Gateway',
      url: legacy.url,
      token: legacy.token,
      deviceToken: legacy.deviceToken,
      createdAt: Date.now(),
    };
    await saveGatewayProfiles([profile]);
    await SecureStore.setItemAsync(ACTIVE_GATEWAY_ID_KEY, profile.id);
  } catch {
    // Ignore malformed legacy state.
  }
}

function isGatewayProfile(value: GatewayProfile): value is GatewayProfile {
  return Boolean(value?.id && value.url && value.token && value.backend === 'openclaw');
}

function defaultGatewayName(url: string): string {
  try {
    return new URL(url).hostname || 'OpenClaw Gateway';
  } catch {
    return 'OpenClaw Gateway';
  }
}

function createGatewayProfileId(): string {
  return `gw-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Earlier versions created a new profile whenever the gateway refreshed its
 * device token. Keep the active (or most recently connected) profile and
 * merge its local conversation history before hiding the redundant entries.
 */
async function collapseDuplicateGatewayProfiles(profiles: GatewayProfile[]): Promise<GatewayProfile[]> {
  const activeId = await SecureStore.getItemAsync(ACTIVE_GATEWAY_ID_KEY);
  const plan = planGatewayProfileDeduplication(profiles, activeId);
  if (plan.profiles.length === profiles.length) return profiles;

  await Promise.all(plan.historyMigrations.map(({ targetId, sourceIds }) => (
    mergeConversationHistories(targetId, sourceIds).catch(() => {})
  )));
  await saveGatewayProfiles(plan.profiles);
  if (plan.activeProfileId && plan.activeProfileId !== activeId) {
    await SecureStore.setItemAsync(ACTIVE_GATEWAY_ID_KEY, plan.activeProfileId);
  }
  return plan.profiles;
}

export interface GatewayProfileDeduplicationPlan {
  profiles: GatewayProfile[];
  activeProfileId: string | null;
  historyMigrations: Array<{ targetId: string; sourceIds: string[] }>;
}

export function planGatewayProfileDeduplication(
  profiles: GatewayProfile[],
  activeId: string | null,
): GatewayProfileDeduplicationPlan {
  const groups = new Map<string, GatewayProfile[]>();
  for (const profile of profiles) {
    const key = JSON.stringify([
      profile.backend,
      normalizedGatewayUrl(profile.url),
      profile.token,
    ]);
    const group = groups.get(key) || [];
    group.push(profile);
    groups.set(key, group);
  }

  const duplicateIds = new Set<string>();
  const historyMigrations: Array<{ targetId: string; sourceIds: string[] }> = [];
  let nextActiveId = activeId;

  for (const group of groups.values()) {
    if (group.length < 2) continue;

    const retained = pickRetainedProfile(group, activeId);
    const duplicates = group.filter((profile) => profile.id !== retained.id);
    duplicates.forEach((profile) => duplicateIds.add(profile.id));
    historyMigrations.push({ targetId: retained.id, sourceIds: duplicates.map((profile) => profile.id) });

    if (activeId && duplicates.some((profile) => profile.id === activeId)) {
      nextActiveId = retained.id;
    }
  }

  return {
    profiles: duplicateIds.size === 0 ? profiles : profiles.filter((profile) => !duplicateIds.has(profile.id)),
    activeProfileId: nextActiveId,
    historyMigrations,
  };
}

function pickRetainedProfile(profiles: GatewayProfile[], activeId: string | null): GatewayProfile {
  return [...profiles].sort((left, right) => {
    if (left.id === activeId) return -1;
    if (right.id === activeId) return 1;
    return (right.lastConnectedAt || right.createdAt) - (left.lastConnectedAt || left.createdAt);
  })[0]!;
}

function normalizedGatewayUrl(value: string): string {
  try {
    const url = new URL(value.trim());
    url.hash = '';
    if (url.pathname === '/') url.pathname = '';
    return url.toString().replace(/\/$/, '');
  } catch {
    return value.trim().replace(/\/$/, '');
  }
}

function isSameGateway(profile: GatewayProfile, input: GatewayProfileInput): boolean {
  return profile.backend === (input.backend || 'openclaw')
    && normalizedGatewayUrl(profile.url) === normalizedGatewayUrl(input.url)
    && profile.token === input.token;
}
