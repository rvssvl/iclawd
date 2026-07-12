import { useMemo, useState } from 'react';
import { View, Text, StyleSheet, Pressable, Alert, Linking } from 'react-native';
import { useRouter } from 'expo-router';
import type { BarcodeScanningResult } from 'expo-camera';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing, fontSize, borderRadius } from '@/constants/theme';
import { describePairingTarget, parseGatewayPairingPayload } from '@/services/GatewayPairing';
import { track } from '@/services/AnalyticsService';

type ExpoCameraModule = typeof import('expo-camera');

function loadCameraModule(): ExpoCameraModule | null {
  try {
    // Keep this dynamic so OTA bundles on older binaries do not crash when the
    // native expo-camera module is not embedded yet.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require('expo-camera') as ExpoCameraModule;
  } catch {
    return null;
  }
}

export default function QrScanScreen() {
  const cameraModule = useMemo(loadCameraModule, []);

  if (!cameraModule) {
    return (
      <QrUnavailable
        title="Camera scanner unavailable"
        subtitle="QR pairing needs the next TestFlight or App Store build because it includes native camera support. You can still enter the gateway URL and token manually."
        errorCategory="unknown"
      />
    );
  }

  return <QrScanCamera cameraModule={cameraModule} />;
}

function QrScanCamera({ cameraModule }: { cameraModule: ExpoCameraModule }) {
  const router = useRouter();
  const [permission, requestPermission] = cameraModule.useCameraPermissions();
  const [scanned, setScanned] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const CameraView = cameraModule.CameraView;

  async function handleRequestPermission() {
    try {
      const result = await requestPermission();
      if (!result.granted && result.canAskAgain === false) {
        Alert.alert(
          'Camera Access Disabled',
          'Enable camera access in system settings to scan gateway QR codes.',
          [
            { text: 'Not Now', style: 'cancel' },
            { text: 'Open Settings', onPress: () => Linking.openSettings() },
          ],
        );
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Camera permission could not be requested.';
      setCameraError(message);
      track('qr_pairing_failed', { screen: 'qr_scan', error_category: 'permission' });
    }
  }

  async function handleBarcodeScanned(result: BarcodeScanningResult) {
    if (scanned) return;
    setScanned(true);

    try {
      const payload = parseGatewayPairingPayload(result.data);
      track('qr_pairing_succeeded', { screen: 'qr_scan', provider: payload.backend });
      Alert.alert(
        'Use this gateway?',
        `${payload.name || 'OpenClaw Gateway'}\n${describePairingTarget(payload)}`,
        [
          {
            text: 'Cancel',
            style: 'cancel',
            onPress: () => setScanned(false),
          },
          {
            text: 'Continue',
            onPress: () => {
              router.replace({
                pathname: '/connect',
                params: {
                  scannedUrl: payload.url,
                  scannedToken: payload.token,
                  scannedName: payload.name || '',
                },
              });
            },
          },
        ],
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Could not read this QR code.';
      track('qr_pairing_failed', { screen: 'qr_scan', error_category: 'unknown' });
      Alert.alert('Invalid QR Code', message, [
        { text: 'Try Again', onPress: () => setScanned(false) },
      ]);
    }
  }

  if (!permission) {
    return <View style={styles.container} />;
  }

  if (cameraError) {
    return (
      <QrUnavailable
        title="Camera could not start"
        subtitle={`${cameraError}\n\nYou can still enter the gateway URL and token manually.`}
        errorCategory="unknown"
      />
    );
  }

  if (!permission.granted) {
    const cameraBlocked = permission.canAskAgain === false;

    return (
      <View style={styles.permissionContainer}>
        <Ionicons name="qr-code-outline" size={42} color={colors.primaryLight} />
        <Text style={styles.title}>Scan Gateway QR</Text>
        <Text style={styles.subtitle}>
          {cameraBlocked
            ? 'Camera access is disabled. Enable it in system settings to scan gateway pairing codes.'
            : 'ClawVoice needs camera access to scan gateway pairing codes.'}
        </Text>
        <Pressable
          style={styles.primaryButton}
          onPress={cameraBlocked ? () => Linking.openSettings() : handleRequestPermission}
        >
          <Text style={styles.primaryButtonText}>{cameraBlocked ? 'Open Settings' : 'Allow Camera'}</Text>
        </Pressable>
        <ManualEntryButton />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <CameraView
        style={StyleSheet.absoluteFillObject}
        facing="back"
        barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
        onBarcodeScanned={scanned ? undefined : handleBarcodeScanned}
        onMountError={(event) => {
          const message = event.message || 'The camera is unavailable on this device.';
          setCameraError(message);
          track('qr_pairing_failed', { screen: 'qr_scan', error_category: 'unknown' });
        }}
      />
      <View style={styles.overlay}>
        <View style={styles.scanBox} />
        <Text style={styles.hint}>Scan a ClawVoice or OpenClaw gateway QR code</Text>
        <ManualEntryButton variant="overlay" />
      </View>
    </View>
  );
}

function QrUnavailable({
  title,
  subtitle,
  errorCategory,
}: {
  title: string;
  subtitle: string;
  errorCategory: 'permission' | 'unknown';
}) {
  const router = useRouter();

  return (
    <View style={styles.permissionContainer}>
      <Ionicons name="qr-code-outline" size={42} color={colors.primaryLight} />
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.subtitle}>{subtitle}</Text>
      <Pressable
        style={styles.primaryButton}
        onPress={() => {
          track('qr_pairing_failed', { screen: 'qr_scan', error_category: errorCategory });
          router.replace('/connect');
        }}
      >
        <Text style={styles.primaryButtonText}>Enter Manually</Text>
      </Pressable>
    </View>
  );
}

function ManualEntryButton({ variant = 'plain' }: { variant?: 'plain' | 'overlay' }) {
  const router = useRouter();
  return (
    <Pressable
      style={variant === 'overlay' ? styles.overlayManualButton : styles.manualButton}
      onPress={() => router.replace('/connect')}
    >
      <Text style={styles.manualButtonText}>Enter manually</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  permissionContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.md,
    padding: spacing.xl,
    backgroundColor: colors.background,
  },
  title: {
    color: colors.text,
    fontSize: fontSize.xl,
    fontWeight: '700',
  },
  subtitle: {
    color: colors.textSecondary,
    fontSize: fontSize.md,
    textAlign: 'center',
    lineHeight: 22,
  },
  primaryButton: {
    marginTop: spacing.md,
    backgroundColor: colors.primary,
    borderRadius: borderRadius.full,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
  },
  primaryButtonText: {
    color: colors.text,
    fontSize: fontSize.md,
    fontWeight: '700',
  },
  manualButton: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  manualButtonText: {
    color: colors.textSecondary,
    fontSize: fontSize.md,
    fontWeight: '600',
  },
  overlayManualButton: {
    marginTop: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderRadius: borderRadius.full,
    backgroundColor: 'rgba(0,0,0,0.36)',
  },
  overlay: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xl,
    backgroundColor: 'rgba(0,0,0,0.24)',
  },
  scanBox: {
    width: 240,
    height: 240,
    borderWidth: 2,
    borderColor: colors.primaryLight,
    borderRadius: borderRadius.lg,
    backgroundColor: 'rgba(255,255,255,0.04)',
  },
  hint: {
    marginTop: spacing.lg,
    color: colors.text,
    fontSize: fontSize.md,
    textAlign: 'center',
    fontWeight: '600',
  },
});
