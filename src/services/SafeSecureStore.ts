import * as SecureStore from 'expo-secure-store';

const memoryFallback = new Map<string, string>();

function describeSecureStoreError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function getItemAsync(key: string): Promise<string | null> {
  try {
    const value = await SecureStore.getItemAsync(key);
    return value ?? memoryFallback.get(key) ?? null;
  } catch (error) {
    console.log('[SecureStore] Falling back to memory read:', describeSecureStoreError(error));
    return memoryFallback.get(key) ?? null;
  }
}

export async function setItemAsync(key: string, value: string): Promise<void> {
  memoryFallback.set(key, value);
  try {
    await SecureStore.setItemAsync(key, value);
  } catch (error) {
    console.log('[SecureStore] Falling back to memory write:', describeSecureStoreError(error));
  }
}

export async function deleteItemAsync(key: string): Promise<void> {
  memoryFallback.delete(key);
  try {
    await SecureStore.deleteItemAsync(key);
  } catch (error) {
    console.log('[SecureStore] Falling back to memory delete:', describeSecureStoreError(error));
  }
}
