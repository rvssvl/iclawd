import { Platform } from 'react-native';

// Siri Shortcuts are iOS-only
const isSiriAvailable = Platform.OS === 'ios';
const SHORTCUTS_APP_STORE_URL = 'https://apps.apple.com/app/shortcuts/id1462947752';
const SHORTCUT_TITLE = 'Clawd Voice';
const SHORTCUT_PHRASE = 'Clawd Voice';

let SiriShortcutsModule: typeof import('react-native-siri-shortcut') | null = null;

async function getSiriModule() {
  if (!isSiriAvailable) return null;
  if (!SiriShortcutsModule) {
    SiriShortcutsModule = await import('react-native-siri-shortcut');
  }
  return SiriShortcutsModule;
}

export const ASK_SHORTCUT = {
  activityType: 'com.rakhimzhan.ai.third.voice.ask',
  title: SHORTCUT_TITLE,
  persistentIdentifier: 'ask-claw-voice',
  requiredUserInfoKeys: ['action'],
  suggestedInvocationPhrase: SHORTCUT_PHRASE,
  isEligibleForSearch: true,
  isEligibleForPrediction: true,
  userInfo: {
    action: 'voice',
  },
};

function isShortcutsAppMissing(error?: string): boolean {
  if (!error) return false;
  return error.includes('Shortcuts app is not installed') || error.includes('VCVoiceShortcutsErrorDomain Code=1004');
}

function showShortcutsAppRequiredAlert() {
  const { Alert, Linking } = require('react-native');
  Alert.alert(
    'Shortcuts App Required',
    'To add a custom Siri phrase, install Apple Shortcuts first. The shortcut has still been suggested to Siri.',
    [
      { text: 'OK', style: 'cancel' },
      {
        text: 'Install Shortcuts',
        onPress: () => Linking.openURL(SHORTCUTS_APP_STORE_URL),
      },
    ],
  );
}

/**
 * Donate the voice shortcut to Siri.
 * Call this once after first successful gateway connection.
 */
export async function donateSiriShortcut(): Promise<void> {
  const mod = await getSiriModule();
  if (!mod) return;

  try {
    mod.donateShortcut(ASK_SHORTCUT);
  } catch (e) {
    console.warn('[Siri] Failed to donate shortcut:', e);
  }
}


/**
 * Add the shortcut to Siri by donating it and informing the user.
 * The native presentShortcut() uses deprecated APIs that don't work on iOS 13+.
 * Instead, we donate the shortcut and tell the user how to set it up in Settings.
 */
export async function addSiriShortcut(): Promise<void> {
  const { Alert, Linking } = require('react-native');

  const mod = await getSiriModule();
  if (!mod) {
    Alert.alert('Not Available', 'Siri Shortcuts are only available on iOS.');
    return;
  }

  try {
    mod.donateShortcut(ASK_SHORTCUT);

    if (mod.supportsPresentShortcut && typeof mod.presentShortcut === 'function') {
      let callbackReceived = false;
      const fallbackTimer = setTimeout(() => {
        if (callbackReceived) return;
        Alert.alert(
          'Shortcut Suggested',
          `If the Add to Siri sheet did not appear, open Siri settings and add the suggested "${SHORTCUT_PHRASE}" shortcut.`,
          [
            { text: 'OK', style: 'cancel' },
            {
              text: 'Open Settings',
              onPress: () => Linking.openURL('App-prefs:SIRI'),
            },
          ],
        );
      }, 2500);

      mod.presentShortcut(ASK_SHORTCUT, (data: { status?: string; phrase?: string; error?: string }) => {
        callbackReceived = true;
        clearTimeout(fallbackTimer);

        if (data.status === 'added' || data.status === 'updated') {
          Alert.alert(
            'Shortcut Ready',
            data.phrase
              ? `Say "Hey Siri, ${data.phrase}" to open voice mode.`
              : 'Your Siri shortcut is ready.',
          );
          return;
        }

        if (data.status === 'deleted') {
          Alert.alert('Shortcut Removed', 'The Siri shortcut was removed.');
          return;
        }

        if (data.status === 'cancelled') {
          if (isShortcutsAppMissing(data.error)) {
            showShortcutsAppRequiredAlert();
          } else if (data.error) {
            Alert.alert(
              'Shortcut Suggested',
              'iOS did not open the Add to Siri sheet, but the shortcut was suggested. You can add it later from Siri settings.',
              [
                { text: 'OK', style: 'cancel' },
                {
                  text: 'Open Settings',
                  onPress: () => Linking.openURL('App-prefs:SIRI'),
                },
              ],
            );
          }
        }
      });
      return;
    }

    Alert.alert('Shortcut Suggested', `Siri can now suggest "${SHORTCUT_PHRASE}". You can also add a custom phrase in Siri settings.`, [
      { text: 'OK', style: 'cancel' },
      {
        text: 'Open Settings',
        onPress: () => Linking.openURL('App-prefs:SIRI'),
      },
    ]);
  } catch (e) {
    console.warn('[Siri] Failed to donate shortcut:', e);
    Alert.alert('Error', 'Failed to add Siri shortcut. Please try again.');
  }
}

/**
 * Check if the app was launched from a Siri shortcut.
 * Returns true if the launch context indicates voice mode should activate.
 */
export function parseSiriLaunchAction(userActivity: { activityType?: string; userInfo?: Record<string, string> } | null): boolean {
  if (!userActivity) return false;
  return (
    userActivity.activityType === ASK_SHORTCUT.activityType &&
    userActivity.userInfo?.action === 'voice'
  );
}

export async function getInitialSiriVoiceLaunch(): Promise<boolean> {
  const mod = await getSiriModule();
  if (!mod?.getInitialShortcut) return false;

  try {
    const shortcut = await mod.getInitialShortcut();
    return parseSiriLaunchAction(shortcut);
  } catch (e) {
    console.warn('[Siri] Failed to read initial shortcut:', e);
    return false;
  }
}

export async function addSiriVoiceLaunchListener(onLaunch: () => void): Promise<() => void> {
  const mod = await getSiriModule();
  if (!mod?.addShortcutListener) return () => {};

  const sub = mod.addShortcutListener((shortcut) => {
    if (parseSiriLaunchAction(shortcut)) {
      onLaunch();
    }
  });

  return () => sub.remove();
}
