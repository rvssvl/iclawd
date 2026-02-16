import { useEffect, useCallback } from 'react';
import { Alert, AppState } from 'react-native';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import * as SplashScreen from 'expo-splash-screen';
import * as Updates from 'expo-updates';
import * as Notifications from 'expo-notifications';
import { useRouter } from 'expo-router';
import { colors } from '@/constants/theme';
import { GatewayProvider } from '@/contexts/GatewayContext';

SplashScreen.preventAutoHideAsync();

async function checkForUpdates() {
  if (__DEV__) return;
  try {
    const update = await Updates.checkForUpdateAsync();
    if (update.isAvailable) {
      await Updates.fetchUpdateAsync();
      Alert.alert('Update Available', 'A new version has been downloaded. Restart to apply.', [
        { text: 'Later', style: 'cancel' },
        { text: 'Restart', onPress: () => Updates.reloadAsync() },
      ]);
    }
  } catch (e) {
    console.log('[Updates] Check failed:', e);
  }
}

export default function RootLayout() {
  const router = useRouter();

  const onLayoutReady = useCallback(async () => {
    await SplashScreen.hideAsync();
  }, []);

  useEffect(() => {
    // Hide splash after a brief delay to ensure UI is rendered
    const timer = setTimeout(onLayoutReady, 300);
    return () => clearTimeout(timer);
  }, [onLayoutReady]);

  // Check for OTA updates on app foreground
  useEffect(() => {
    checkForUpdates();
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') checkForUpdates();
    });
    return () => sub.remove();
  }, []);

  // Request notification permissions
  useEffect(() => {
    Notifications.requestPermissionsAsync().catch(() => {});
  }, []);

  // Handle notification tap → navigate to chat
  useEffect(() => {
    const sub = Notifications.addNotificationResponseReceivedListener(() => {
      router.push('/chat');
    });
    return () => sub.remove();
  }, [router]);

  return (
    <GatewayProvider>
      <StatusBar style="light" />
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: colors.background },
          headerTintColor: colors.text,
          headerTitleStyle: { fontWeight: '600' },
          contentStyle: { backgroundColor: colors.background },
          headerShadowVisible: false,
          animation: 'fade',
          animationDuration: 250,
        }}
      >
        <Stack.Screen
          name="index"
          options={{ headerShown: false }}
        />
        <Stack.Screen
          name="connect"
          options={{
            title: 'Connect to Gateway',
            presentation: 'modal',
            animation: 'slide_from_bottom',
          }}
        />
        <Stack.Screen
          name="chat"
          options={{ title: 'iClawd', headerBackTitle: 'Back' }}
        />
        <Stack.Screen
          name="voice"
          options={{ title: 'Voice', headerBackTitle: 'Back' }}
        />
        <Stack.Screen
          name="setup-guide"
          options={{
            title: 'Setup Guide',
            presentation: 'modal',
            animation: 'slide_from_bottom',
          }}
        />
        <Stack.Screen
          name="settings"
          options={{ title: 'Settings' }}
        />
      </Stack>
    </GatewayProvider>
  );
}
