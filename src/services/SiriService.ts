import { Platform } from 'react-native';

// Siri Shortcuts are iOS-only
const isSiriAvailable = Platform.OS === 'ios';

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
  title: 'Ask Claw',
  suggestedInvocationPhrase: 'Ask Claw',
  isEligibleForSearch: true,
  isEligibleForPrediction: true,
  userInfo: {
    action: 'voice',
  },
};

/**
 * Donate the "Ask Claw" shortcut to Siri.
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
    Alert.alert(
      'Shortcut Added',
      'The "Ask Claw" shortcut has been donated to Siri.\n\nTo set a custom phrase, go to:\nSettings → Siri & Search → My Shortcuts\n\nOr just say "Hey Siri, Ask Claw".',
      [
        { text: 'OK', style: 'cancel' },
        {
          text: 'Open Settings',
          onPress: () => Linking.openURL('App-prefs:SIRI'),
        },
      ],
    );
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
