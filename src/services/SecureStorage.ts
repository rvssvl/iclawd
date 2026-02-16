import * as SecureStore from 'expo-secure-store';
import type { GatewayConfig } from '@/types/gateway';

const GATEWAY_CONFIG_KEY = 'iclawd_gateway_config';

export async function saveGatewayConfig(config: GatewayConfig): Promise<void> {
  await SecureStore.setItemAsync(GATEWAY_CONFIG_KEY, JSON.stringify(config));
}

export async function getGatewayConfig(): Promise<GatewayConfig | null> {
  const raw = await SecureStore.getItemAsync(GATEWAY_CONFIG_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as GatewayConfig;
  } catch {
    return null;
  }
}

export async function deleteGatewayConfig(): Promise<void> {
  await SecureStore.deleteItemAsync(GATEWAY_CONFIG_KEY);
}

export async function updateDeviceToken(deviceToken: string): Promise<void> {
  const config = await getGatewayConfig();
  if (config) {
    config.deviceToken = deviceToken;
    await saveGatewayConfig(config);
  }
}
