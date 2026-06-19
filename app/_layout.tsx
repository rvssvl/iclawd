import { useState, useEffect, useCallback, useRef } from 'react';
import {
  View,
  Text,
  Pressable,
  StyleSheet,
  Animated,
  AppState,
  Linking,
  type AppStateStatus,
} from 'react-native';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import * as SplashScreen from 'expo-splash-screen';
import * as Updates from 'expo-updates';
import type * as ExpoNotifications from 'expo-notifications';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, fontSize, spacing, borderRadius } from '@/constants/theme';
import { GatewayProvider } from '@/contexts/GatewayContext';
import { addCarPlayCommandListener } from '@/services/CarPlayBridge';
import { addWatchCommandListener } from '@/services/WatchBridge';
import { addSiriVoiceLaunchListener, getInitialSiriVoiceLaunch } from '@/services/SiriService';
import { captureCampaignFromUrl, initializeAnalytics, track } from '@/services/AnalyticsService';

SplashScreen.preventAutoHideAsync();

function getNotifications(): typeof ExpoNotifications | null {
  if (__DEV__) return null;
  return require('expo-notifications') as typeof ExpoNotifications;
}

type UpdateStatus = 'idle' | 'checking' | 'downloading' | 'ready' | 'error';

function UpdateBanner() {
  const insets = useSafeAreaInsets();
  const [status, setStatus] = useState<UpdateStatus>('idle');
  const statusRef = useRef<UpdateStatus>('idle');
  const progressAnim = useRef(new Animated.Value(0)).current;
  const bannerOpacity = useRef(new Animated.Value(0)).current;
  const appStateRef = useRef<AppStateStatus>(AppState.currentState);

  // Keep ref in sync with state
  statusRef.current = status;

  const checkForUpdates = useCallback(async () => {
    if (__DEV__) return;

    // Don't re-check if already downloading or update is ready
    const current = statusRef.current;
    if (current === 'downloading' || current === 'ready') return;

    try {
      setStatus('checking');
      const update = await Updates.checkForUpdateAsync();

      if (!update.isAvailable) {
        setStatus('idle');
        return;
      }

      // Show banner
      setStatus('downloading');
      progressAnim.setValue(0);
      Animated.timing(bannerOpacity, {
        toValue: 1,
        duration: 200,
        useNativeDriver: true,
      }).start();

      // Animate progress to 80% while downloading
      Animated.timing(progressAnim, {
        toValue: 0.8,
        duration: 2000,
        useNativeDriver: false,
      }).start();

      await Updates.fetchUpdateAsync();

      // Complete progress bar
      Animated.timing(progressAnim, {
        toValue: 1,
        duration: 300,
        useNativeDriver: false,
      }).start();

      setStatus('ready');
    } catch (e) {
      console.log('[Updates] Check failed:', e);
      setStatus('error');
      setTimeout(() => {
        Animated.timing(bannerOpacity, {
          toValue: 0,
          duration: 200,
          useNativeDriver: true,
        }).start(() => setStatus('idle'));
      }, 2000);
    }
  }, [progressAnim, bannerOpacity]);

  // Check on mount + every time app returns to foreground
  useEffect(() => {
    checkForUpdates();

    const sub = AppState.addEventListener('change', (nextState: AppStateStatus) => {
      if (appStateRef.current.match(/inactive|background/) && nextState === 'active') {
        checkForUpdates();
      }
      appStateRef.current = nextState;
    });

    return () => sub.remove();
  }, [checkForUpdates]);

  const handleRestart = () => {
    Updates.reloadAsync();
  };

  const handleDismiss = () => {
    Animated.timing(bannerOpacity, {
      toValue: 0,
      duration: 200,
      useNativeDriver: true,
    }).start(() => {
      setStatus('idle');
      progressAnim.setValue(0);
    });
  };

  if (status === 'idle' || status === 'checking') return null;

  return (
    <Animated.View style={[styles.banner, { opacity: bannerOpacity, paddingTop: insets.top }]}>
      {/* Progress bar */}
      <View style={styles.progressTrack}>
        <Animated.View
          style={[
            styles.progressFill,
            status === 'ready'
              ? { width: '100%' }
              : {
                  width: progressAnim.interpolate({
                    inputRange: [0, 1],
                    outputRange: ['0%', '100%'],
                  }),
                },
          ]}
        />
      </View>

      {/* Content */}
      {status === 'downloading' && (
        <View style={styles.bannerContent}>
          <Text style={styles.bannerText}>Downloading update...</Text>
        </View>
      )}

      {status === 'ready' && (
        <View style={styles.readyContent}>
          <Text style={styles.readyText}>Update ready</Text>
          <View style={styles.readyActions}>
            <Pressable onPress={handleDismiss} hitSlop={8}>
              <Text style={styles.laterText}>Later</Text>
            </Pressable>
            <Pressable style={styles.restartButton} onPress={handleRestart}>
              <Text style={styles.restartText}>Restart Now</Text>
            </Pressable>
          </View>
        </View>
      )}

      {status === 'error' && (
        <View style={styles.bannerContent}>
          <Text style={styles.errorText}>Update failed</Text>
        </View>
      )}
    </Animated.View>
  );
}

export default function RootLayout() {
  const router = useRouter();
  const handledInitialSiriRef = useRef(false);

  const onLayoutReady = useCallback(async () => {
    await SplashScreen.hideAsync();
  }, []);

  useEffect(() => {
    const timer = setTimeout(onLayoutReady, 300);
    return () => clearTimeout(timer);
  }, [onLayoutReady]);

  useEffect(() => {
    initializeAnalytics()
      .then(() => track('app_opened', { screen: 'root' }))
      .catch(() => {});

    Linking.getInitialURL()
      .then(captureCampaignFromUrl)
      .catch(() => {});

    const sub = Linking.addEventListener('url', ({ url }) => {
      captureCampaignFromUrl(url).catch(() => {});
    });

    return () => sub.remove();
  }, []);

  // Request notification permissions
  useEffect(() => {
    const notifications = getNotifications();
    notifications?.requestPermissionsAsync().catch(() => {});
  }, []);

  // Handle notification tap → navigate to chat
  useEffect(() => {
    const notifications = getNotifications();
    if (!notifications) return;
    const sub = notifications.addNotificationResponseReceivedListener(() => {
      router.push('/chat');
    });
    return () => sub.remove();
  }, [router]);

  // Handle Siri shortcut launch → navigate to voice mode
  useEffect(() => {
    let mounted = true;
    let unsubscribe: (() => void) | null = null;

    getInitialSiriVoiceLaunch().then((shouldOpenVoice) => {
      if (!mounted || !shouldOpenVoice || handledInitialSiriRef.current) return;
      handledInitialSiriRef.current = true;
      router.replace('/voice');
    });

    addSiriVoiceLaunchListener(() => {
      router.replace('/voice');
    }).then((cleanup) => {
      if (!mounted) {
        cleanup();
        return;
      }
      unsubscribe = cleanup;
    });

    return () => {
      mounted = false;
      unsubscribe?.();
    };
  }, [router]);

  // Handle CarPlay launch/control → navigate to voice mode
  useEffect(() => {
    return addCarPlayCommandListener((command) => {
      if (
        command.action !== 'startVoice'
        && command.action !== 'toggleVoice'
        && command.action !== 'stopAudio'
        && command.action !== 'pauseVoice'
      ) return;
      track('carplay_opened', { action: command.action, carplay: true });
      if (command.action === 'startVoice' || command.action === 'toggleVoice') {
        track('carplay_voice_started', { carplay: true });
      } else if (command.action === 'pauseVoice') {
        track('carplay_voice_paused', { carplay: true });
      } else if (command.action === 'stopAudio') {
        track('carplay_audio_stopped', { carplay: true });
      }
      router.replace({
        pathname: '/voice',
        params: {
          carplayStart: String(command.timestamp ?? Date.now()),
          carplayAction: command.action,
        },
      });
    });
  }, [router]);

  // Handle Apple Watch launch/control → navigate to voice mode
  useEffect(() => {
    return addWatchCommandListener((command) => {
      if (
        command.action !== 'startVoice'
        && command.action !== 'stopAudio'
        && command.action !== 'pauseVoice'
        && command.action !== 'requestStatus'
      ) return;
      track('watch_opened', { action: command.action, watch: true });
      if (command.action === 'startVoice') {
        track('watch_voice_started', { watch: true });
      } else if (command.action === 'pauseVoice') {
        track('watch_voice_paused', { watch: true });
      } else if (command.action === 'stopAudio') {
        track('watch_audio_stopped', { watch: true });
      }
      router.replace({
        pathname: '/voice',
        params: {
          watchStart: String(command.timestamp ?? Date.now()),
          watchAction: command.action,
        },
      });
    });
  }, [router]);

  return (
    <GatewayProvider>
      <StatusBar style="light" />
      <UpdateBanner />
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
          options={{ title: 'ClawVoice', headerBackTitle: 'Back' }}
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

const styles = StyleSheet.create({
  banner: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 1000,
    backgroundColor: colors.surface,
  },
  progressTrack: {
    height: 3,
    backgroundColor: colors.border,
    width: '100%',
  },
  progressFill: {
    height: 3,
    backgroundColor: colors.primary,
  },
  bannerContent: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    alignItems: 'center',
  },
  bannerText: {
    fontSize: fontSize.xs,
    color: colors.textSecondary,
  },
  errorText: {
    fontSize: fontSize.xs,
    color: colors.error,
  },
  readyContent: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  readyText: {
    fontSize: fontSize.sm,
    fontWeight: '600',
    color: colors.text,
  },
  readyActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  laterText: {
    fontSize: fontSize.sm,
    color: colors.textMuted,
  },
  restartButton: {
    backgroundColor: colors.primary,
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
    borderRadius: borderRadius.sm,
  },
  restartText: {
    fontSize: fontSize.sm,
    fontWeight: '600',
    color: '#FFFFFF',
  },
});
