const {
  withDangerousMod,
  withInfoPlist,
  withXcodeProject,
} = require('@expo/config-plugins');
const fs = require('fs');
const path = require('path');
const { withBuildSourceFile } = require('@expo/config-plugins/build/ios/XcodeProjectFile');

const CARPLAY_ENTITLEMENT = 'com.apple.developer.carplay-voice-based-conversation';
const CARPLAY_SCENE_ROLE = 'CPTemplateApplicationSceneSessionRoleApplication';
const APP_SCENE_ROLE = 'UIWindowSceneSessionRoleApplication';
const CARPLAY_DEBUG_CONFIGURATION = 'CarPlayDebug';

const sceneDelegate = `import Expo
import React
import UIKit

@available(iOS 13.0, *)
@objc(SceneDelegate)
class SceneDelegate: UIResponder, UIWindowSceneDelegate {
  var window: UIWindow?

  func scene(
    _ scene: UIScene,
    willConnectTo session: UISceneSession,
    options connectionOptions: UIScene.ConnectionOptions
  ) {
    guard let windowScene = scene as? UIWindowScene,
      let appDelegate = UIApplication.shared.delegate as? AppDelegate,
      let factory = appDelegate.reactNativeFactory
    else {
      return
    }

    let window = UIWindow(windowScene: windowScene)
    self.window = window
    appDelegate.window = window

    factory.startReactNative(
      withModuleName: "main",
      in: window,
      launchOptions: nil
    )
    window.makeKeyAndVisible()
  }
}
`;

const carPlaySceneDelegate = `import CarPlay
import UIKit

@available(iOS 14.0, *)
@objc(CarPlaySceneDelegate)
class CarPlaySceneDelegate: UIResponder, CPTemplateApplicationSceneDelegate {
  private static weak var activeDelegate: CarPlaySceneDelegate?
  private static var latestStatus: CarPlayStatus = .ready

  private var interfaceController: CPInterfaceController?
  private var rootTemplate: CPListTemplate?
  private var voiceTemplate: CPVoiceControlTemplate?

  func templateApplicationScene(
    _ templateApplicationScene: CPTemplateApplicationScene,
    didConnect interfaceController: CPInterfaceController
  ) {
    CarPlaySceneDelegate.activeDelegate = self
    self.interfaceController = interfaceController
    interfaceController.prefersDarkUserInterfaceStyle = true
    NSLog("[ClawVoice CarPlay] Connected")

    let template = makeRootTemplate()
    rootTemplate = template
    interfaceController.setRootTemplate(template, animated: false) { _, error in
      if let error {
        NSLog("[ClawVoice CarPlay] Failed to set root template: \\(error.localizedDescription)")
      } else {
        NSLog("[ClawVoice CarPlay] Root template set")
      }
    }
  }

  func templateApplicationScene(
    _ templateApplicationScene: CPTemplateApplicationScene,
    didDisconnectInterfaceController interfaceController: CPInterfaceController
  ) {
    NSLog("[ClawVoice CarPlay] Disconnected")
    self.interfaceController = nil
    self.rootTemplate = nil
    self.voiceTemplate = nil
    if CarPlaySceneDelegate.activeDelegate === self {
      CarPlaySceneDelegate.activeDelegate = nil
    }
  }

  static func updateSharedStatus(_ status: NSDictionary) {
    latestStatus = CarPlayStatus(dictionary: status)
    activeDelegate?.applyStatus(latestStatus)
  }

  private func makeRootTemplate() -> CPListTemplate {
    return CPListTemplate(
      title: "ClawVoice",
      sections: [makeRootSection()]
    )
  }

  private func makeRootSection() -> CPListSection {
    let status = CarPlaySceneDelegate.latestStatus
    let startItem = CPListItem(
      text: status.primaryActionTitle,
      detailText: status.primaryActionSubtitle,
      image: UIImage(systemName: status.primaryActionSymbol)
    )
    startItem.accessoryType = .disclosureIndicator
    startItem.handler = { [weak self] _, completion in
      CarPlayBridge.sendCommand(status.primaryActionCommand)
      self?.presentVoiceTemplate()
      completion()
    }

    let statusItem = CPListItem(
      text: "Status",
      detailText: status.subtitle,
      image: UIImage(systemName: status.symbol)
    )
    statusItem.isEnabled = false

    return CPListSection(items: [startItem, statusItem])
  }

  private func presentVoiceTemplate() {
    guard let interfaceController else {
      return
    }

    let template = makeVoiceTemplate()
    voiceTemplate = template
    interfaceController.presentTemplate(template, animated: true) { _, error in
      if let error {
        NSLog("[ClawVoice CarPlay] Failed to present voice template: \\(error.localizedDescription)")
      } else {
        NSLog("[ClawVoice CarPlay] Voice template presented")
      }
    }
  }

  private func makeVoiceTemplate() -> CPVoiceControlTemplate {
    let states = [
      CPVoiceControlState(
        identifier: "ready",
        titleVariants: ["ClawVoice is ready", "Ready"],
        image: UIImage(systemName: "mic.circle"),
        repeats: true
      ),
      CPVoiceControlState(
        identifier: "connecting",
        titleVariants: ["Connecting to ClawVoice", "Connecting"],
        image: UIImage(systemName: "antenna.radiowaves.left.and.right.circle"),
        repeats: true
      ),
      CPVoiceControlState(
        identifier: "listening",
        titleVariants: ["Listening", "Speak now"],
        image: UIImage(systemName: "waveform.circle"),
        repeats: true
      ),
      CPVoiceControlState(
        identifier: "thinking",
        titleVariants: ["Agent is thinking", "Thinking"],
        image: UIImage(systemName: "ellipsis.circle"),
        repeats: true
      ),
      CPVoiceControlState(
        identifier: "speaking",
        titleVariants: ["Speaking response", "Speaking"],
        image: UIImage(systemName: "speaker.wave.2.circle"),
        repeats: true
      ),
      CPVoiceControlState(
        identifier: "paused",
        titleVariants: ["Voice paused", "Paused"],
        image: UIImage(systemName: "pause.circle"),
        repeats: true
      ),
      CPVoiceControlState(
        identifier: "error",
        titleVariants: ["Check iPhone", "Voice unavailable"],
        image: UIImage(systemName: "exclamationmark.circle"),
        repeats: true
      )
    ]

    let template = CPVoiceControlTemplate(voiceControlStates: states)
    template.activateVoiceControlState(withIdentifier: CarPlaySceneDelegate.latestStatus.stateIdentifier)
    return template
  }

  private func applyStatus(_ status: CarPlayStatus) {
    rootTemplate?.updateSections([makeRootSection()])
    voiceTemplate?.activateVoiceControlState(withIdentifier: status.stateIdentifier)
  }
}

@available(iOS 14.0, *)
private struct CarPlayStatus {
  let stateIdentifier: String
  let title: String
  let subtitle: String

  static let ready = CarPlayStatus(
    stateIdentifier: "ready",
    title: "ClawVoice is ready",
    subtitle: "Ready on iPhone"
  )

  init(dictionary: NSDictionary) {
    let rawState = dictionary["state"] as? String ?? "ready"
    let rawTitle = dictionary["title"] as? String ?? "ClawVoice is ready"
    let rawSubtitle = dictionary["subtitle"] as? String

    switch rawState {
    case "connecting":
      stateIdentifier = "connecting"
    case "listening":
      stateIdentifier = "listening"
    case "thinking":
      stateIdentifier = "thinking"
    case "speaking":
      stateIdentifier = "speaking"
    case "paused":
      stateIdentifier = "paused"
    case "error":
      stateIdentifier = "error"
    default:
      stateIdentifier = "ready"
    }

    title = rawTitle
    subtitle = rawSubtitle ?? rawTitle
  }

  private init(stateIdentifier: String, title: String, subtitle: String) {
    self.stateIdentifier = stateIdentifier
    self.title = title
    self.subtitle = subtitle
  }

  var symbol: String {
    switch stateIdentifier {
    case "connecting":
      return "antenna.radiowaves.left.and.right.circle"
    case "listening":
      return "waveform.circle"
    case "thinking":
      return "ellipsis.circle"
    case "speaking":
      return "speaker.wave.2.circle"
    case "paused":
      return "pause.circle"
    case "error":
      return "exclamationmark.circle"
    default:
      return "iphone"
    }
  }

  var primaryActionTitle: String {
    switch stateIdentifier {
    case "listening":
      return "Pause Voice"
    case "speaking":
      return "Stop Audio"
    case "connecting", "thinking":
      return "Open Voice"
    default:
      return "Start Voice"
    }
  }

  var primaryActionSubtitle: String {
    switch stateIdentifier {
    case "listening":
      return "Pause the hands-free session"
    case "speaking":
      return "Stop response playback"
    case "connecting", "thinking":
      return "Show current voice status"
    default:
      return "Open hands-free voice control"
    }
  }

  var primaryActionCommand: String {
    switch stateIdentifier {
    case "listening":
      return "pauseVoice"
    case "speaking":
      return "stopAudio"
    default:
      return "startVoice"
    }
  }

  var primaryActionSymbol: String {
    switch stateIdentifier {
    case "listening":
      return "pause.circle"
    case "speaking":
      return "speaker.slash.circle"
    default:
      return "mic.circle"
    }
  }
}
`;

const carPlayBridgeSwift = `import Foundation
import React

@objc(CarPlayBridge)
class CarPlayBridge: RCTEventEmitter {
  private static weak var shared: CarPlayBridge?
  private static var pendingCommands: [[String: Any]] = []
  private static var hasListeners = false

  override init() {
    super.init()
    CarPlayBridge.shared = self
  }

  override static func requiresMainQueueSetup() -> Bool {
    true
  }

  override func supportedEvents() -> [String]! {
    ["iClawdCarPlayCommand"]
  }

  override func startObserving() {
    CarPlayBridge.hasListeners = true
    let commands = CarPlayBridge.pendingCommands
    CarPlayBridge.pendingCommands.removeAll()
    commands.forEach { body in
      sendEvent(withName: "iClawdCarPlayCommand", body: body)
    }
  }

  override func stopObserving() {
    CarPlayBridge.hasListeners = false
  }

  @objc(setStatus:)
  func setStatus(_ status: NSDictionary) {
    DispatchQueue.main.async {
      CarPlaySceneDelegate.updateSharedStatus(status)
    }
  }

  static func sendCommand(_ action: String) {
    let body: [String: Any] = [
      "action": action,
      "timestamp": Int(Date().timeIntervalSince1970 * 1000),
    ]

    guard hasListeners, let shared else {
      pendingCommands.append(body)
      return
    }

    shared.sendEvent(withName: "iClawdCarPlayCommand", body: body)
  }
}
`;

const carPlayBridgeObjC = `#import <React/RCTBridgeModule.h>
#import <React/RCTEventEmitter.h>

@interface RCT_EXTERN_MODULE(CarPlayBridge, RCTEventEmitter)
RCT_EXTERN_METHOD(setStatus:(NSDictionary *)status)
@end
`;

function withCarPlayInfoPlist(config) {
  return withInfoPlist(config, (config) => {
    const infoPlist = config.modResults;
    const sceneManifest = infoPlist.UIApplicationSceneManifest ?? {};
    const sceneConfigurations = sceneManifest.UISceneConfigurations ?? {};

    sceneConfigurations[APP_SCENE_ROLE] = [
      {
        UISceneConfigurationName: 'Default Configuration',
        UISceneDelegateClassName: '$(PRODUCT_MODULE_NAME).SceneDelegate',
      },
    ];

    sceneConfigurations[CARPLAY_SCENE_ROLE] = [
      {
        UISceneClassName: 'CPTemplateApplicationScene',
        UISceneConfigurationName: 'ClawVoice CarPlay',
        UISceneDelegateClassName: '$(PRODUCT_MODULE_NAME).CarPlaySceneDelegate',
      },
    ];

    infoPlist.UIApplicationSceneManifest = {
      ...sceneManifest,
      UIApplicationSupportsMultipleScenes: true,
      UISceneConfigurations: sceneConfigurations,
    };

    return config;
  });
}

function withCarPlayEntitlement(config) {
  config = withDangerousMod(config, [
    'ios',
    async (config) => {
      const projectName = config.modRequest.projectName;
      const entitlementsPath = path.join(
        config.modRequest.platformProjectRoot,
        projectName,
        `${projectName}.entitlements`
      );

      fs.mkdirSync(path.dirname(entitlementsPath), { recursive: true });
      let source = fs.existsSync(entitlementsPath)
        ? fs.readFileSync(entitlementsPath, 'utf8')
        : makeEmptyEntitlementsPlist();

      if (!source.includes(CARPLAY_ENTITLEMENT)) {
        source = source.replace(
          '</dict>',
          `  <key>${CARPLAY_ENTITLEMENT}</key>\n  <true/>\n</dict>`
        );
      }

      fs.writeFileSync(entitlementsPath, source);
      return config;
    },
  ]);

  return withXcodeProject(config, (config) => {
    const project = config.modResults;
    const nativeTarget = project.pbxTargetByName(config.modRequest.projectName);
    const configurationLists = project.pbxXCConfigurationList();
    const configurationList = nativeTarget?.buildConfigurationList
      ? configurationLists[nativeTarget.buildConfigurationList]
      : undefined;
    const buildConfigurations = project.pbxXCBuildConfigurationSection();

    for (const entry of configurationList?.buildConfigurations ?? []) {
      const buildSettings = buildConfigurations[entry.value]?.buildSettings;
      if (!buildSettings) continue;
      buildSettings.CODE_SIGN_ENTITLEMENTS = `${config.modRequest.projectName}/${config.modRequest.projectName}.entitlements`;
    }

    return config;
  });
}

function makeEmptyEntitlementsPlist() {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
</dict>
</plist>
`;
}

function withSimulatorSigningWorkaround(config) {
  return withXcodeProject(config, (config) => {
    return config;
  });
}

function cloneBuildSettings(settings) {
  return JSON.parse(JSON.stringify(settings ?? {}));
}

function addConfigurationToList(project, configurationListId, sourceName, configuration) {
  const configurationLists = project.pbxXCConfigurationList();
  const buildConfigurations = project.pbxXCBuildConfigurationSection();
  const configurationList = configurationLists[configurationListId];
  if (!configurationList) {
    return;
  }

  const exists = configurationList.buildConfigurations.some(
    (entry) => entry.comment === configuration.name
  );
  if (exists) {
    return;
  }

  const sourceEntry = configurationList.buildConfigurations.find(
    (entry) => entry.comment === sourceName
  );
  const sourceConfiguration = sourceEntry
    ? buildConfigurations[sourceEntry.value]
    : undefined;
  if (!sourceConfiguration) {
    return;
  }

  const uuid = project.generateUuid();
  buildConfigurations[uuid] = {
    isa: 'XCBuildConfiguration',
    baseConfigurationReference: sourceConfiguration.baseConfigurationReference,
    buildSettings: {
      ...cloneBuildSettings(sourceConfiguration.buildSettings),
      ...configuration.buildSettings,
    },
    name: configuration.name,
  };
  buildConfigurations[`${uuid}_comment`] = configuration.name;
  configurationList.buildConfigurations.push({
    value: uuid,
    comment: configuration.name,
  });
}

function withCarPlayDebugBuildConfiguration(config) {
  return withXcodeProject(config, (config) => {
    const project = config.modResults;
    const projectRoot = project.getFirstProject().firstProject;
    const nativeTarget = project.pbxTargetByName(config.modRequest.projectName);

    addConfigurationToList(
      project,
      projectRoot.buildConfigurationList,
      'Debug',
      {
        name: CARPLAY_DEBUG_CONFIGURATION,
        buildSettings: {
          SWIFT_ACTIVE_COMPILATION_CONDITIONS:
            '"$(inherited) DEBUG ICLAWD_CARPLAY_DEBUG"',
        },
      }
    );

    if (nativeTarget?.buildConfigurationList) {
      addConfigurationToList(
        project,
        nativeTarget.buildConfigurationList,
        'Debug',
        {
          name: CARPLAY_DEBUG_CONFIGURATION,
          buildSettings: {
            CODE_SIGN_ENTITLEMENTS: `${config.modRequest.projectName}/${config.modRequest.projectName}.entitlements`,
            OTHER_SWIFT_FLAGS:
              '"$(inherited) -D EXPO_CONFIGURATION_DEBUG -D ICLAWD_CARPLAY_DEBUG"',
          },
        }
      );
    }

    return config;
  });
}

function withCarPlaySceneDelegate(config) {
  config = withBuildSourceFile(config, {
    filePath: 'SceneDelegate.swift',
    contents: sceneDelegate,
    overwrite: true,
  });

  config = withBuildSourceFile(config, {
    filePath: 'CarPlaySceneDelegate.swift',
    contents: carPlaySceneDelegate,
    overwrite: true,
  });

  config = withBuildSourceFile(config, {
    filePath: 'CarPlayBridge.swift',
    contents: carPlayBridgeSwift,
    overwrite: true,
  });

  return withBuildSourceFile(config, {
    filePath: 'CarPlayBridge.m',
    contents: carPlayBridgeObjC,
    overwrite: true,
  });
}

function withCarPlayBridgeHeader(config) {
  return withDangerousMod(config, [
    'ios',
    async (config) => {
      const headerPath = path.join(
        config.modRequest.platformProjectRoot,
        config.modRequest.projectName,
        `${config.modRequest.projectName}-Bridging-Header.h`
      );

      if (!fs.existsSync(headerPath)) {
        return config;
      }

      let source = fs.readFileSync(headerPath, 'utf8');
      for (const line of [
        '#import <React/RCTBridgeModule.h>',
        '#import <React/RCTEventEmitter.h>',
      ]) {
        if (!source.includes(line)) {
          source += `\n${line}`;
        }
      }

      fs.writeFileSync(headerPath, source);
      return config;
    },
  ]);
}

function withCarPlayDebugPodfile(config) {
  return withDangerousMod(config, [
    'ios',
    async (config) => {
      const podfilePath = path.join(config.modRequest.platformProjectRoot, 'Podfile');
      const mapping = `project '${config.modRequest.projectName}', '${CARPLAY_DEBUG_CONFIGURATION}' => :debug`;

      if (!fs.existsSync(podfilePath)) {
        return config;
      }

      const source = fs.readFileSync(podfilePath, 'utf8');
      if (source.includes(mapping)) {
        return config;
      }

      const nextSource = source.replace(
        /(platform :ios, .+\n)/,
        `$1\n${mapping}\n`
      );
      fs.writeFileSync(podfilePath, nextSource);
      return config;
    },
  ]);
}

function withCarPlayDebugScheme(config) {
  return withDangerousMod(config, [
    'ios',
    async (config) => {
      const project = config.modRequest.projectName;
      const schemePath = path.join(
        config.modRequest.platformProjectRoot,
        `${project}.xcodeproj`,
        'xcshareddata',
        'xcschemes',
        `${project}-CarPlayDebug.xcscheme`
      );
      const scheme = `<?xml version="1.0" encoding="UTF-8"?>
<Scheme LastUpgradeVersion="2650" version="1.7">
  <BuildAction parallelizeBuildables="YES" buildImplicitDependencies="YES" buildArchitectures="Automatic">
    <BuildActionEntries>
      <BuildActionEntry buildForTesting="YES" buildForRunning="YES" buildForProfiling="YES" buildForArchiving="YES" buildForAnalyzing="YES">
        <BuildableReference BuildableIdentifier="primary" BlueprintIdentifier="13B07F861A680F5B00A75B9A" BuildableName="${project}.app" BlueprintName="${project}" ReferencedContainer="container:${project}.xcodeproj"></BuildableReference>
      </BuildActionEntry>
    </BuildActionEntries>
  </BuildAction>
  <TestAction buildConfiguration="${CARPLAY_DEBUG_CONFIGURATION}" selectedDebuggerIdentifier="Xcode.DebuggerFoundation.Debugger.LLDB" selectedLauncherIdentifier="Xcode.DebuggerFoundation.Launcher.LLDB" shouldUseLaunchSchemeArgsEnv="YES"></TestAction>
  <LaunchAction buildConfiguration="${CARPLAY_DEBUG_CONFIGURATION}" selectedDebuggerIdentifier="Xcode.DebuggerFoundation.Debugger.LLDB" selectedLauncherIdentifier="Xcode.DebuggerFoundation.Launcher.LLDB" launchStyle="0" useCustomWorkingDirectory="NO" ignoresPersistentStateOnLaunch="NO" debugDocumentVersioning="YES" debugServiceExtension="internal" allowLocationSimulation="YES">
    <BuildableProductRunnable runnableDebuggingMode="0">
      <BuildableReference BuildableIdentifier="primary" BlueprintIdentifier="13B07F861A680F5B00A75B9A" BuildableName="${project}.app" BlueprintName="${project}" ReferencedContainer="container:${project}.xcodeproj"></BuildableReference>
    </BuildableProductRunnable>
  </LaunchAction>
  <ProfileAction buildConfiguration="${CARPLAY_DEBUG_CONFIGURATION}" shouldUseLaunchSchemeArgsEnv="YES" savedToolIdentifier="" useCustomWorkingDirectory="NO" debugDocumentVersioning="YES">
    <BuildableProductRunnable runnableDebuggingMode="0">
      <BuildableReference BuildableIdentifier="primary" BlueprintIdentifier="13B07F861A680F5B00A75B9A" BuildableName="${project}.app" BlueprintName="${project}" ReferencedContainer="container:${project}.xcodeproj"></BuildableReference>
    </BuildableProductRunnable>
  </ProfileAction>
  <AnalyzeAction buildConfiguration="${CARPLAY_DEBUG_CONFIGURATION}"></AnalyzeAction>
  <ArchiveAction buildConfiguration="Release" revealArchiveInOrganizer="YES"></ArchiveAction>
</Scheme>
`;

      fs.mkdirSync(path.dirname(schemePath), { recursive: true });
      fs.writeFileSync(schemePath, scheme);
      return config;
    },
  ]);
}

function withSceneAwareAppDelegate(config) {
  return withDangerousMod(config, [
    'ios',
    async (config) => {
      const appDelegatePath = path.join(
        config.modRequest.platformProjectRoot,
        config.modRequest.projectName,
        'AppDelegate.swift'
      );

      const oldSource = `#if os(iOS) || os(tvOS)
    window = UIWindow(frame: UIScreen.main.bounds)
    factory.startReactNative(
      withModuleName: "main",
      in: window,
      launchOptions: launchOptions)
#endif`;
      const newSource = `#if os(iOS) || os(tvOS)
    if #available(iOS 13.0, *),
      Bundle.main.object(forInfoDictionaryKey: "UIApplicationSceneManifest") != nil {
      return super.application(application, didFinishLaunchingWithOptions: launchOptions)
    }

    window = UIWindow(frame: UIScreen.main.bounds)
    factory.startReactNative(
      withModuleName: "main",
      in: window,
      launchOptions: launchOptions)
#endif`;

      const source = fs.readFileSync(appDelegatePath, 'utf8');
      if (!source.includes('UIApplicationSceneManifest')) {
        fs.writeFileSync(appDelegatePath, source.replace(oldSource, newSource));
      }

      return config;
    },
  ]);
}

module.exports = function withCarPlay(config) {
  config = withCarPlayInfoPlist(config);
  config = withCarPlayEntitlement(config);
  config = withCarPlayDebugBuildConfiguration(config);
  config = withSimulatorSigningWorkaround(config);
  config = withCarPlaySceneDelegate(config);
  config = withCarPlayBridgeHeader(config);
  config = withCarPlayDebugPodfile(config);
  config = withCarPlayDebugScheme(config);
  config = withSceneAwareAppDelegate(config);
  return config;
};
