const { withInfoPlist } = require('@expo/config-plugins');
const { withBuildSourceFile } = require('@expo/config-plugins/build/ios/XcodeProjectFile');

const appIntentsSwift = `import AppIntents
import Foundation

@available(iOS 18.0, *)
struct StartClawVoiceIntent: AppIntent {
  static var title: LocalizedStringResource = "Start Voice in ClawVoice"
  static var description = IntentDescription("Open ClawVoice voice mode.")
  static var openAppWhenRun: Bool = true

  @MainActor
  func perform() async throws -> some IntentResult & OpensIntent {
    return .result(opensIntent: OpenURLIntent(URL(string: "clawvoice://voice")!))
  }
}

@available(iOS 18.0, *)
struct ClawVoiceShortcutsProvider: AppShortcutsProvider {
  static var appShortcuts: [AppShortcut] {
    AppShortcut(
      intent: StartClawVoiceIntent(),
      phrases: [
        "Start voice in \\(.applicationName)",
        "Ask \\(.applicationName)"
      ],
      shortTitle: "Start Voice",
      systemImageName: "mic.circle"
    )
  }
}
`;

module.exports = function withAppIntents(config) {
  config = withInfoPlist(config, (config) => {
    const infoPlist = config.modResults;
    const existing = Array.isArray(infoPlist.NSUserActivityTypes)
      ? infoPlist.NSUserActivityTypes
      : [];
    const activityType = 'com.rakhimzhan.ai.third.voice.ask';
    if (!existing.includes(activityType)) {
      infoPlist.NSUserActivityTypes = [...existing, activityType];
    }

    const urlTypes = Array.isArray(infoPlist.CFBundleURLTypes)
      ? infoPlist.CFBundleURLTypes
      : [];
    const appUrlType = urlTypes.find((item) => {
      const schemes = Array.isArray(item.CFBundleURLSchemes) ? item.CFBundleURLSchemes : [];
      return schemes.includes('clawvoice') || schemes.includes('iclawd');
    }) || { CFBundleURLSchemes: [] };
    const appSchemes = new Set(Array.isArray(appUrlType.CFBundleURLSchemes) ? appUrlType.CFBundleURLSchemes : []);
    appSchemes.add('clawvoice');
    appSchemes.add('iclawd');
    appUrlType.CFBundleURLSchemes = [...appSchemes];

    if (!urlTypes.includes(appUrlType)) {
      urlTypes.unshift(appUrlType);
    }
    infoPlist.CFBundleURLTypes = urlTypes;
    return config;
  });

  return withBuildSourceFile(config, {
    filePath: 'ClawVoiceAppIntents.swift',
    contents: appIntentsSwift,
    overwrite: true,
  });
};
