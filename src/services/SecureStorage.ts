import * as SecureStore from '@/services/SafeSecureStore';
import type { GatewayConfig } from '@/types/gateway';
import {
  deleteGatewayProfile,
  gatewayProfileToConfig,
  getActiveGatewayProfile,
  saveGatewayProfile,
} from '@/services/GatewayProfiles';

const GATEWAY_CONFIG_KEY = 'iclawd_gateway_config';

export async function saveGatewayConfig(config: GatewayConfig): Promise<void> {
  await SecureStore.setItemAsync(GATEWAY_CONFIG_KEY, JSON.stringify(config));
  const activeProfile = await getActiveGatewayProfile();
  await saveGatewayProfile(
    { ...config, backend: 'openclaw' },
    activeProfile ? { id: activeProfile.id } : undefined,
  );
}

export async function getGatewayConfig(): Promise<GatewayConfig | null> {
  const activeProfile = await getActiveGatewayProfile();
  if (activeProfile) return gatewayProfileToConfig(activeProfile);

  const raw = await SecureStore.getItemAsync(GATEWAY_CONFIG_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as GatewayConfig;
  } catch {
    return null;
  }
}

export async function deleteGatewayConfig(): Promise<void> {
  const activeProfile = await getActiveGatewayProfile();
  if (activeProfile) {
    await deleteGatewayProfile(activeProfile.id);
  }
  await SecureStore.deleteItemAsync(GATEWAY_CONFIG_KEY);
}

export async function updateDeviceToken(deviceToken: string): Promise<void> {
  const config = await getGatewayConfig();
  if (config) {
    await saveGatewayConfig({ ...config, deviceToken });
  }
}
