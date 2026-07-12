import * as SecureStore from '@/services/SafeSecureStore';
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
    return parsed.filter(isGatewayProfile);
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
  const existingIndex = options.id ? profiles.findIndex((profile) => profile.id === options.id) : -1;
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
