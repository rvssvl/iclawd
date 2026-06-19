const {
  withDangerousMod,
  withXcodeProject,
} = require('@expo/config-plugins');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { withBuildSourceFile } = require('@expo/config-plugins/build/ios/XcodeProjectFile');

const WATCH_TARGET_NAME = 'ClawVoice Watch App';
const WATCH_PRODUCT_NAME = 'ClawVoiceWatch';
const WATCH_FOLDER = 'ClawVoiceWatch';
const WATCH_BUNDLE_SUFFIX = '.watchkitapp';
const WATCH_DEPLOYMENT_TARGET = '10.0';

const watchBridgeSwift = `import Foundation
import React
import WatchConnectivity

@objc(WatchBridge)
class WatchBridge: RCTEventEmitter, WCSessionDelegate {
  private static weak var shared: WatchBridge?
  private static var pendingCommands: [[String: Any]] = []
  private static var hasListeners = false
  private static var latestStatus: [String: Any] = [
    "state": "ready",
    "title": "ClawVoice is ready",
    "subtitle": "Ready on iPhone"
  ]

  override init() {
    super.init()
    WatchBridge.shared = self
    configureSession()
  }

  override static func requiresMainQueueSetup() -> Bool {
    true
  }

  override func supportedEvents() -> [String]! {
    ["clawVoiceWatchCommand"]
  }

  override func startObserving() {
    WatchBridge.hasListeners = true
    let commands = WatchBridge.pendingCommands
    WatchBridge.pendingCommands.removeAll()
    commands.forEach { body in
      sendEvent(withName: "clawVoiceWatchCommand", body: body)
    }
  }

  override func stopObserving() {
    WatchBridge.hasListeners = false
  }

  @objc(setStatus:)
  func setStatus(_ status: NSDictionary) {
    var next: [String: Any] = [:]
    status.forEach { key, value in
      if let key = key as? String {
        next[key] = value
      }
    }
    WatchBridge.latestStatus = next
    sendStatusToWatch(next)
  }

  private func configureSession() {
    guard WCSession.isSupported() else {
      return
    }

    let session = WCSession.default
    session.delegate = self
    session.activate()
  }

  private func sendStatusToWatch(_ status: [String: Any]) {
    guard WCSession.isSupported() else {
      return
    }

    do {
      try WCSession.default.updateApplicationContext(["status": status])
    } catch {
      NSLog("[ClawVoice Watch] Failed to update application context: \\(error.localizedDescription)")
    }

    if WCSession.default.isReachable {
      WCSession.default.sendMessage(["status": status], replyHandler: nil) { error in
        NSLog("[ClawVoice Watch] Failed to send live status: \\(error.localizedDescription)")
      }
    }
  }

  private func receiveCommand(_ message: [String: Any], replyHandler: (([String: Any]) -> Void)? = nil) {
    if let command = message["command"] as? String, command == "requestStatus" {
      replyHandler?(["status": WatchBridge.latestStatus])
      return
    }

    guard let action = message["action"] as? String else {
      replyHandler?(["status": WatchBridge.latestStatus, "error": "missing_action"])
      return
    }

    let allowedActions = ["startVoice", "pauseVoice", "stopAudio", "requestStatus"]
    guard allowedActions.contains(action) else {
      replyHandler?(["status": WatchBridge.latestStatus, "error": "unsupported_action"])
      return
    }

    if action == "requestStatus" {
      replyHandler?(["status": WatchBridge.latestStatus])
      return
    }

    let body: [String: Any] = [
      "action": action,
      "timestamp": Int(Date().timeIntervalSince1970 * 1000)
    ]

    if WatchBridge.hasListeners, let shared = WatchBridge.shared {
      shared.sendEvent(withName: "clawVoiceWatchCommand", body: body)
    } else {
      WatchBridge.pendingCommands.append(body)
    }

    replyHandler?(["status": WatchBridge.latestStatus])
  }

  func session(_ session: WCSession, didReceiveMessage message: [String : Any]) {
    receiveCommand(message)
  }

  func session(_ session: WCSession, didReceiveMessage message: [String : Any], replyHandler: @escaping ([String : Any]) -> Void) {
    receiveCommand(message, replyHandler: replyHandler)
  }

  func session(_ session: WCSession, activationDidCompleteWith activationState: WCSessionActivationState, error: Error?) {
    if let error {
      NSLog("[ClawVoice Watch] Session activation failed: \\(error.localizedDescription)")
    }
  }

  func sessionDidBecomeInactive(_ session: WCSession) {}

  func sessionDidDeactivate(_ session: WCSession) {
    session.activate()
  }
}
`;

const watchBridgeObjC = `#import <React/RCTBridgeModule.h>
#import <React/RCTEventEmitter.h>

@interface RCT_EXTERN_MODULE(WatchBridge, RCTEventEmitter)
RCT_EXTERN_METHOD(setStatus:(NSDictionary *)status)
@end
`;

const watchAppSwift = `import SwiftUI

@main
struct ClawVoiceWatchApp: App {
  @StateObject private var session = WatchSession()

  var body: some Scene {
    WindowGroup {
      ContentView()
        .environmentObject(session)
    }
  }
}
`;

const watchSessionSwift = `import Foundation
import WatchConnectivity

final class WatchSession: NSObject, ObservableObject, WCSessionDelegate {
  @Published var status = VoiceStatus.ready
  @Published var reachable = false
  @Published var lastError: String?

  override init() {
    super.init()
    guard WCSession.isSupported() else {
      status = .openPhone
      return
    }

    let session = WCSession.default
    session.delegate = self
    session.activate()
  }

  var primaryTitle: String {
    switch status.state {
    case "listening":
      return "Pause"
    case "speaking":
      return "Stop Audio"
    default:
      return "Start Voice"
    }
  }

  var primarySymbol: String {
    switch status.state {
    case "listening":
      return "pause.circle.fill"
    case "speaking":
      return "speaker.slash.circle.fill"
    default:
      return "mic.circle.fill"
    }
  }

  var primaryAction: String {
    switch status.state {
    case "listening":
      return "pauseVoice"
    case "speaking":
      return "stopAudio"
    default:
      return "startVoice"
    }
  }

  func sendPrimaryAction() {
    send(action: primaryAction)
  }

  func requestStatus() {
    send(message: ["command": "requestStatus"])
  }

  private func send(action: String) {
    send(message: ["action": action])
  }

  private func send(message: [String: Any]) {
    guard WCSession.isSupported(), WCSession.default.activationState == .activated, WCSession.default.isReachable else {
      DispatchQueue.main.async {
        self.reachable = false
        self.status = .openPhone
        self.lastError = "Open ClawVoice on iPhone"
      }
      return
    }

    WCSession.default.sendMessage(message, replyHandler: { reply in
      self.apply(reply)
    }, errorHandler: { error in
      DispatchQueue.main.async {
        self.reachable = false
        self.status = .openPhone
        self.lastError = error.localizedDescription
      }
    })
  }

  private func apply(_ message: [String: Any]) {
    if let rawStatus = message["status"] as? [String: Any] {
      DispatchQueue.main.async {
        self.status = VoiceStatus(dictionary: rawStatus)
        self.reachable = true
        self.lastError = nil
      }
    }
  }

  func session(_ session: WCSession, activationDidCompleteWith activationState: WCSessionActivationState, error: Error?) {
    DispatchQueue.main.async {
      self.reachable = activationState == .activated && session.isReachable
      if let error {
        self.status = .openPhone
        self.lastError = error.localizedDescription
      } else {
        self.requestStatus()
      }
    }
  }

  func sessionReachabilityDidChange(_ session: WCSession) {
    DispatchQueue.main.async {
      self.reachable = session.isReachable
      if session.isReachable {
        self.requestStatus()
      } else {
        self.status = .openPhone
      }
    }
  }

  func session(_ session: WCSession, didReceiveApplicationContext applicationContext: [String : Any]) {
    apply(applicationContext)
  }

  func session(_ session: WCSession, didReceiveMessage message: [String : Any]) {
    apply(message)
  }
}

struct VoiceStatus {
  let state: String
  let title: String
  let subtitle: String

  static let ready = VoiceStatus(
    state: "ready",
    title: "Ready",
    subtitle: "Start voice on iPhone"
  )

  static let openPhone = VoiceStatus(
    state: "error",
    title: "Open iPhone",
    subtitle: "Open ClawVoice on iPhone"
  )

  init(dictionary: [String: Any]) {
    let rawState = dictionary["state"] as? String ?? "ready"
    switch rawState {
    case "connecting", "listening", "thinking", "speaking", "paused", "error":
      state = rawState
    default:
      state = "ready"
    }

    title = VoiceStatus.shortTitle(dictionary["title"] as? String, state: state)
    subtitle = VoiceStatus.shortSubtitle(dictionary["subtitle"] as? String, state: state)
  }

  private init(state: String, title: String, subtitle: String) {
    self.state = state
    self.title = title
    self.subtitle = subtitle
  }

  private static func title(for state: String) -> String {
    switch state {
    case "connecting":
      return "Connecting"
    case "listening":
      return "Listening"
    case "thinking":
      return "Thinking"
    case "speaking":
      return "Speaking"
    case "paused":
      return "Paused"
    case "error":
      return "Connection issue"
    default:
      return "Ready"
    }
  }

  private static func shortTitle(_ rawTitle: String?, state: String) -> String {
    guard let rawTitle, !rawTitle.isEmpty else {
      return title(for: state)
    }

    if rawTitle.localizedCaseInsensitiveContains("unavailable") {
      return "Open iPhone"
    }

    if rawTitle.count > 18 {
      return title(for: state)
    }

    return rawTitle
  }

  private static func shortSubtitle(_ rawSubtitle: String?, state: String) -> String {
    let fallback: String = {
      switch state {
      case "connecting":
        return "Connecting to phone"
      case "listening":
        return "Listening on iPhone"
      case "thinking":
        return "Agent is replying"
      case "speaking":
        return "Playing on iPhone"
      case "paused":
        return "Tap to resume"
      case "error":
        return "Open phone app"
      default:
        return "Tap to start"
      }
    }()

    guard let rawSubtitle, !rawSubtitle.isEmpty else {
      return fallback
    }

    if rawSubtitle.localizedCaseInsensitiveContains("foreground") ||
       rawSubtitle.localizedCaseInsensitiveContains("open clawvoice") ||
       rawSubtitle.localizedCaseInsensitiveContains("unavailable") {
      return "Open phone app"
    }

    if rawSubtitle.count > 32 {
      return fallback
    }

    return rawSubtitle
  }
}
`;

const contentViewSwift = `import SwiftUI

struct ContentView: View {
  @EnvironmentObject private var session: WatchSession

  var body: some View {
    GeometryReader { proxy in
      ScrollView {
        VStack(spacing: 10) {
          Image(systemName: symbolName)
            .font(.system(size: 28, weight: .semibold))
            .foregroundStyle(accentColor)

          Text(session.status.title)
            .font(.headline)
            .multilineTextAlignment(.center)
            .lineLimit(2)
            .minimumScaleFactor(0.72)

          Text(session.status.subtitle)
            .font(.caption2)
            .foregroundStyle(.secondary)
            .multilineTextAlignment(.center)
            .lineLimit(2)
            .minimumScaleFactor(0.72)

          Button {
            session.sendPrimaryAction()
          } label: {
            Label(session.primaryTitle, systemImage: session.primarySymbol)
              .lineLimit(1)
              .minimumScaleFactor(0.75)
          }
          .buttonStyle(.borderedProminent)
          .tint(accentColor)
          .disabled(session.status.title == "Open iPhone")
        }
        .frame(maxWidth: .infinity)
        .frame(minHeight: proxy.size.height)
        .padding(.horizontal, 8)
        .padding(.vertical, 6)
      }
    }
    .onAppear {
      session.requestStatus()
    }
  }

  private var symbolName: String {
    switch session.status.state {
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
      return "mic.circle"
    }
  }

  private var accentColor: Color {
    switch session.status.state {
    case "listening", "speaking":
      return .green
    case "thinking":
      return .orange
    case "error":
      return .red
    default:
      return .purple
    }
  }
}
`;

function withWatchBridgeSource(config) {
  config = withBuildSourceFile(config, {
    filePath: 'WatchBridge.swift',
    contents: watchBridgeSwift,
    overwrite: true,
  });

  return withBuildSourceFile(config, {
    filePath: 'WatchBridge.m',
    contents: watchBridgeObjC,
    overwrite: true,
  });
}

function withWatchBridgeHeader(config) {
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

function withWatchFiles(config) {
  return withDangerousMod(config, [
    'ios',
    async (config) => {
      const watchRoot = path.join(config.modRequest.platformProjectRoot, WATCH_FOLDER);
      const assetRoot = path.join(watchRoot, 'Assets.xcassets');
      const iconRoot = path.join(assetRoot, 'AppIcon.appiconset');
      fs.mkdirSync(iconRoot, { recursive: true });

      fs.writeFileSync(path.join(watchRoot, 'ClawVoiceWatchApp.swift'), watchAppSwift);
      fs.writeFileSync(path.join(watchRoot, 'WatchSession.swift'), watchSessionSwift);
      fs.writeFileSync(path.join(watchRoot, 'ContentView.swift'), contentViewSwift);
      fs.writeFileSync(path.join(watchRoot, 'Info.plist'), makeWatchInfoPlist(config.ios?.bundleIdentifier));
      fs.writeFileSync(path.join(watchRoot, `${WATCH_FOLDER}.entitlements`), makeWatchEntitlementsPlist());
      fs.writeFileSync(path.join(assetRoot, 'Contents.json'), JSON.stringify({ info: { author: 'xcode', version: 1 } }, null, 2));
      fs.writeFileSync(path.join(iconRoot, 'Contents.json'), JSON.stringify(makeWatchAppIconContents(), null, 2));
      writeWatchAppIcons(config.modRequest.projectRoot, iconRoot);

      return config;
    },
  ]);
}

function writeWatchAppIcons(projectRoot, iconRoot) {
  const sourceIcon = path.join(projectRoot, 'assets', 'icon.png');
  if (!fs.existsSync(sourceIcon)) {
    return;
  }

  for (const icon of WATCH_APP_ICONS) {
    const output = path.join(iconRoot, icon.filename);
    if (icon.pixels === 1024) {
      fs.copyFileSync(sourceIcon, output);
      continue;
    }

    try {
      execFileSync('sips', ['-z', String(icon.pixels), String(icon.pixels), sourceIcon, '--out', output], {
        stdio: 'ignore',
      });
    } catch {
      fs.copyFileSync(sourceIcon, output);
    }
  }
}

function makeWatchInfoPlist(companionBundleId) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleDevelopmentRegion</key>
  <string>$(DEVELOPMENT_LANGUAGE)</string>
  <key>CFBundleDisplayName</key>
  <string>ClawVoice</string>
  <key>CFBundleExecutable</key>
  <string>$(EXECUTABLE_NAME)</string>
  <key>CFBundleIdentifier</key>
  <string>$(PRODUCT_BUNDLE_IDENTIFIER)</string>
  <key>CFBundleInfoDictionaryVersion</key>
  <string>6.0</string>
  <key>CFBundleName</key>
  <string>$(PRODUCT_NAME)</string>
  <key>CFBundlePackageType</key>
  <string>$(PRODUCT_BUNDLE_PACKAGE_TYPE)</string>
  <key>CFBundleShortVersionString</key>
  <string>$(MARKETING_VERSION)</string>
  <key>CFBundleVersion</key>
  <string>$(CURRENT_PROJECT_VERSION)</string>
  <key>WKCompanionAppBundleIdentifier</key>
  <string>${companionBundleId || '$(CLAWVOICE_COMPANION_BUNDLE_IDENTIFIER)'}</string>
  <key>WKApplication</key>
  <true/>
</dict>
</plist>
`;
}

function makeWatchEntitlementsPlist() {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict/>
</plist>
`;
}

function makeWatchAppIconContents() {
  return {
    images: WATCH_APP_ICONS.map(({ pixels, ...image }) => image),
    info: {
      author: 'xcode',
      version: 1,
    },
  };
}

const WATCH_APP_ICONS = [
  { idiom: 'watch', role: 'notificationCenter', scale: '2x', size: '24x24', subtype: '38mm', filename: 'Icon-24x24@2x.png', pixels: 48 },
  { idiom: 'watch', role: 'notificationCenter', scale: '2x', size: '27.5x27.5', subtype: '42mm', filename: 'Icon-27.5x27.5@2x.png', pixels: 55 },
  { idiom: 'watch', role: 'notificationCenter', scale: '2x', size: '33x33', subtype: '45mm', filename: 'Icon-33x33@2x.png', pixels: 66 },
  { idiom: 'watch', role: 'companionSettings', scale: '2x', size: '29x29', filename: 'Icon-29x29@2x.png', pixels: 58 },
  { idiom: 'watch', role: 'companionSettings', scale: '3x', size: '29x29', filename: 'Icon-29x29@3x.png', pixels: 87 },
  { idiom: 'watch', role: 'appLauncher', scale: '2x', size: '40x40', subtype: '38mm', filename: 'Icon-40x40@2x.png', pixels: 80 },
  { idiom: 'watch', role: 'appLauncher', scale: '2x', size: '44x44', subtype: '40mm', filename: 'Icon-44x44@2x.png', pixels: 88 },
  { idiom: 'watch', role: 'appLauncher', scale: '2x', size: '46x46', subtype: '41mm', filename: 'Icon-46x46@2x.png', pixels: 92 },
  { idiom: 'watch', role: 'appLauncher', scale: '2x', size: '50x50', subtype: '44mm', filename: 'Icon-50x50@2x.png', pixels: 100 },
  { idiom: 'watch', role: 'appLauncher', scale: '2x', size: '51x51', subtype: '45mm', filename: 'Icon-51x51@2x.png', pixels: 102 },
  { idiom: 'watch', role: 'appLauncher', scale: '2x', size: '54x54', subtype: '49mm', filename: 'Icon-54x54@2x.png', pixels: 108 },
  { idiom: 'watch', role: 'quickLook', scale: '2x', size: '86x86', subtype: '38mm', filename: 'Icon-86x86@2x.png', pixels: 172 },
  { idiom: 'watch', role: 'quickLook', scale: '2x', size: '98x98', subtype: '42mm', filename: 'Icon-98x98@2x.png', pixels: 196 },
  { idiom: 'watch', role: 'quickLook', scale: '2x', size: '108x108', subtype: '44mm', filename: 'Icon-108x108@2x.png', pixels: 216 },
  { idiom: 'watch', role: 'quickLook', scale: '2x', size: '117x117', subtype: '45mm', filename: 'Icon-117x117@2x.png', pixels: 234 },
  { idiom: 'watch', role: 'quickLook', scale: '2x', size: '129x129', subtype: '49mm', filename: 'Icon-129x129@2x.png', pixels: 258 },
  { idiom: 'watch-marketing', scale: '1x', size: '1024x1024', filename: 'Icon-1024x1024@1x.png', pixels: 1024 },
];

function withWatchXcodeProject(config) {
  return withXcodeProject(config, (config) => {
    const project = config.modResults;
    const projectName = config.modRequest.projectName;
    const appTarget = project.pbxTargetByName(projectName);
    if (!appTarget) {
      return config;
    }

    if (project.pbxTargetByName(WATCH_TARGET_NAME)) {
      return config;
    }

    const appBundleId = stripQuotes(getBundleIdentifier(project, appTarget) || config.ios?.bundleIdentifier);
    const watchBundleId = `${appBundleId}${WATCH_BUNDLE_SUFFIX}`;
    const projectObject = project.getFirstProject().firstProject;
    const productsGroupId = project.findPBXGroupKey({ name: 'Products' }) || project.getFirstProject().firstProject.productRefGroup;
    const mainGroupId = project.getFirstProject().firstProject.mainGroup;

    const watchProductFileId = project.generateUuid();
    const watchProductBuildFileId = project.generateUuid();
    const watchTargetId = project.generateUuid();
    const watchSourcesPhaseId = project.generateUuid();
    const watchResourcesPhaseId = project.generateUuid();
    const watchConfigListId = project.generateUuid();
    const watchDebugConfigId = project.generateUuid();
    const watchReleaseConfigId = project.generateUuid();
    const watchCarPlayDebugConfigId = project.generateUuid();
    const watchGroupId = project.generateUuid();
    const watchAssetFileId = project.generateUuid();
    const watchInfoFileId = project.generateUuid();
    const watchAppSwiftFileId = project.generateUuid();
    const watchSessionFileId = project.generateUuid();
    const watchContentFileId = project.generateUuid();
    const watchAppSwiftBuildId = project.generateUuid();
    const watchSessionBuildId = project.generateUuid();
    const watchContentBuildId = project.generateUuid();
    const watchAssetsBuildId = project.generateUuid();
    const embedPhaseId = project.generateUuid();
    const targetDependencyId = project.generateUuid();
    const containerProxyId = project.generateUuid();

    const objects = project.hash.project.objects;
    objects.PBXBuildFile = objects.PBXBuildFile || {};
    objects.PBXContainerItemProxy = objects.PBXContainerItemProxy || {};
    objects.PBXCopyFilesBuildPhase = objects.PBXCopyFilesBuildPhase || {};
    objects.PBXFileReference = objects.PBXFileReference || {};
    objects.PBXGroup = objects.PBXGroup || {};
    objects.PBXNativeTarget = objects.PBXNativeTarget || {};
    objects.PBXResourcesBuildPhase = objects.PBXResourcesBuildPhase || {};
    objects.PBXSourcesBuildPhase = objects.PBXSourcesBuildPhase || {};
    objects.PBXTargetDependency = objects.PBXTargetDependency || {};
    objects.XCBuildConfiguration = objects.XCBuildConfiguration || {};
    objects.XCConfigurationList = objects.XCConfigurationList || {};

    objects.PBXFileReference[watchProductFileId] = {
      isa: 'PBXFileReference',
      explicitFileType: 'wrapper.application',
      includeInIndex: 0,
      path: `"${WATCH_PRODUCT_NAME}.app"`,
      sourceTree: 'BUILT_PRODUCTS_DIR',
    };
    objects.PBXFileReference[`${watchProductFileId}_comment`] = `${WATCH_PRODUCT_NAME}.app`;

    addFileReference(project, watchAssetFileId, 'folder.assetcatalog', 'Assets.xcassets', `${WATCH_FOLDER}/Assets.xcassets`);
    addFileReference(project, watchInfoFileId, 'text.plist.xml', 'Info.plist', `${WATCH_FOLDER}/Info.plist`);
    addFileReference(project, watchAppSwiftFileId, 'sourcecode.swift', 'ClawVoiceWatchApp.swift', `${WATCH_FOLDER}/ClawVoiceWatchApp.swift`);
    addFileReference(project, watchSessionFileId, 'sourcecode.swift', 'WatchSession.swift', `${WATCH_FOLDER}/WatchSession.swift`);
    addFileReference(project, watchContentFileId, 'sourcecode.swift', 'ContentView.swift', `${WATCH_FOLDER}/ContentView.swift`);

    objects.PBXBuildFile[watchProductBuildFileId] = {
      isa: 'PBXBuildFile',
      fileRef: watchProductFileId,
      settings: { ATTRIBUTES: ['RemoveHeadersOnCopy'] },
    };
    objects.PBXBuildFile[`${watchProductBuildFileId}_comment`] = `${WATCH_PRODUCT_NAME}.app in Embed Watch Content`;

    addBuildFile(project, watchAppSwiftBuildId, watchAppSwiftFileId, 'ClawVoiceWatchApp.swift in Sources');
    addBuildFile(project, watchSessionBuildId, watchSessionFileId, 'WatchSession.swift in Sources');
    addBuildFile(project, watchContentBuildId, watchContentFileId, 'ContentView.swift in Sources');
    addBuildFile(project, watchAssetsBuildId, watchAssetFileId, 'Assets.xcassets in Resources');

    objects.PBXGroup[watchGroupId] = {
      isa: 'PBXGroup',
      children: [
        { value: watchAppSwiftFileId, comment: 'ClawVoiceWatchApp.swift' },
        { value: watchSessionFileId, comment: 'WatchSession.swift' },
        { value: watchContentFileId, comment: 'ContentView.swift' },
        { value: watchAssetFileId, comment: 'Assets.xcassets' },
        { value: watchInfoFileId, comment: 'Info.plist' },
      ],
      name: WATCH_FOLDER,
      sourceTree: '"<group>"',
    };
    objects.PBXGroup[`${watchGroupId}_comment`] = WATCH_FOLDER;
    objects.PBXGroup[mainGroupId].children.push({ value: watchGroupId, comment: WATCH_FOLDER });
    objects.PBXGroup[productsGroupId].children.push({ value: watchProductFileId, comment: `${WATCH_PRODUCT_NAME}.app` });

    objects.PBXSourcesBuildPhase[watchSourcesPhaseId] = {
      isa: 'PBXSourcesBuildPhase',
      buildActionMask: 2147483647,
      files: [
        { value: watchAppSwiftBuildId, comment: 'ClawVoiceWatchApp.swift in Sources' },
        { value: watchSessionBuildId, comment: 'WatchSession.swift in Sources' },
        { value: watchContentBuildId, comment: 'ContentView.swift in Sources' },
      ],
      runOnlyForDeploymentPostprocessing: 0,
    };
    objects.PBXSourcesBuildPhase[`${watchSourcesPhaseId}_comment`] = 'Sources';

    objects.PBXResourcesBuildPhase[watchResourcesPhaseId] = {
      isa: 'PBXResourcesBuildPhase',
      buildActionMask: 2147483647,
      files: [
        { value: watchAssetsBuildId, comment: 'Assets.xcassets in Resources' },
      ],
      runOnlyForDeploymentPostprocessing: 0,
    };
    objects.PBXResourcesBuildPhase[`${watchResourcesPhaseId}_comment`] = 'Resources';

    const baseBuildSettings = getAppBuildSettings(project, appTarget);
    const commonWatchSettings = {
      ASSETCATALOG_COMPILER_APPICON_NAME: 'AppIcon',
      CODE_SIGN_ENTITLEMENTS: `${WATCH_FOLDER}/${WATCH_FOLDER}.entitlements`,
      CODE_SIGN_STYLE: baseBuildSettings.CODE_SIGN_STYLE || 'Automatic',
      CURRENT_PROJECT_VERSION: baseBuildSettings.CURRENT_PROJECT_VERSION || '1',
      DEVELOPMENT_TEAM: baseBuildSettings.DEVELOPMENT_TEAM,
      GENERATE_INFOPLIST_FILE: 'NO',
      INFOPLIST_FILE: `${WATCH_FOLDER}/Info.plist`,
      LD_RUNPATH_SEARCH_PATHS: ['"$(inherited)"', '"@executable_path/Frameworks"'],
      MARKETING_VERSION: baseBuildSettings.MARKETING_VERSION || '1.0',
      PRODUCT_BUNDLE_IDENTIFIER: watchBundleId,
      PRODUCT_NAME: `"${WATCH_PRODUCT_NAME}"`,
      SDKROOT: 'watchos',
      SKIP_INSTALL: 'YES',
      SUPPORTED_PLATFORMS: '"watchos watchsimulator"',
      SWIFT_VERSION: '5.0',
      TARGETED_DEVICE_FAMILY: 4,
      WATCHOS_DEPLOYMENT_TARGET: WATCH_DEPLOYMENT_TARGET,
    };

    objects.XCBuildConfiguration[watchDebugConfigId] = makeBuildConfiguration('Debug', {
      ...commonWatchSettings,
      ARCHS: 'arm64',
      ENABLE_PREVIEWS: 'YES',
      ONLY_ACTIVE_ARCH: 'YES',
      SWIFT_OPTIMIZATION_LEVEL: '"-Onone"',
    });
    objects.XCBuildConfiguration[`${watchDebugConfigId}_comment`] = 'Debug';

    objects.XCBuildConfiguration[watchReleaseConfigId] = makeBuildConfiguration('Release', commonWatchSettings);
    objects.XCBuildConfiguration[`${watchReleaseConfigId}_comment`] = 'Release';

    objects.XCBuildConfiguration[watchCarPlayDebugConfigId] = makeBuildConfiguration('CarPlayDebug', {
      ...commonWatchSettings,
      ARCHS: 'arm64',
      ENABLE_PREVIEWS: 'YES',
      ONLY_ACTIVE_ARCH: 'YES',
      SWIFT_OPTIMIZATION_LEVEL: '"-Onone"',
    });
    objects.XCBuildConfiguration[`${watchCarPlayDebugConfigId}_comment`] = 'CarPlayDebug';

    objects.XCConfigurationList[watchConfigListId] = {
      isa: 'XCConfigurationList',
      buildConfigurations: [
        { value: watchDebugConfigId, comment: 'Debug' },
        { value: watchReleaseConfigId, comment: 'Release' },
        { value: watchCarPlayDebugConfigId, comment: 'CarPlayDebug' },
      ],
      defaultConfigurationIsVisible: 0,
      defaultConfigurationName: 'Release',
    };
    objects.XCConfigurationList[`${watchConfigListId}_comment`] = `Build configuration list for PBXNativeTarget "${WATCH_TARGET_NAME}"`;

    objects.PBXNativeTarget[watchTargetId] = {
      isa: 'PBXNativeTarget',
      buildConfigurationList: watchConfigListId,
      buildPhases: [
        { value: watchSourcesPhaseId, comment: 'Sources' },
        { value: watchResourcesPhaseId, comment: 'Resources' },
      ],
      buildRules: [],
      dependencies: [],
      name: `"${WATCH_TARGET_NAME}"`,
      productName: `"${WATCH_PRODUCT_NAME}"`,
      productReference: watchProductFileId,
      productType: '"com.apple.product-type.application"',
    };
    objects.PBXNativeTarget[`${watchTargetId}_comment`] = WATCH_TARGET_NAME;

    objects.PBXContainerItemProxy[containerProxyId] = {
      isa: 'PBXContainerItemProxy',
      containerPortal: project.getFirstProject().uuid,
      proxyType: 1,
      remoteGlobalIDString: watchTargetId,
      remoteInfo: `"${WATCH_TARGET_NAME}"`,
    };
    objects.PBXContainerItemProxy[`${containerProxyId}_comment`] = `PBXContainerItemProxy`;

    objects.PBXTargetDependency[targetDependencyId] = {
      isa: 'PBXTargetDependency',
      target: watchTargetId,
      targetProxy: containerProxyId,
    };
    objects.PBXTargetDependency[`${targetDependencyId}_comment`] = `PBXTargetDependency`;
    appTarget.dependencies.push({ value: targetDependencyId, comment: WATCH_TARGET_NAME });

    objects.PBXCopyFilesBuildPhase[embedPhaseId] = {
      isa: 'PBXCopyFilesBuildPhase',
      buildActionMask: 2147483647,
      dstPath: '"$(CONTENTS_FOLDER_PATH)/Watch"',
      dstSubfolderSpec: 16,
      files: [
        { value: watchProductBuildFileId, comment: `${WATCH_PRODUCT_NAME}.app in Embed Watch Content` },
      ],
      name: '"Embed Watch Content"',
      runOnlyForDeploymentPostprocessing: 0,
    };
    objects.PBXCopyFilesBuildPhase[`${embedPhaseId}_comment`] = 'Embed Watch Content';
    appTarget.buildPhases.push({ value: embedPhaseId, comment: 'Embed Watch Content' });

    projectObject.targets.push({ value: watchTargetId, comment: WATCH_TARGET_NAME });
    projectObject.attributes.TargetAttributes[watchTargetId] = {
      CreatedOnToolsVersion: '26.0',
    };

    return config;
  });
}

function withWatchSigningCleanup(config) {
  return withXcodeProject(config, (config) => {
    const project = config.modResults;
    const watchTarget = project.pbxTargetByName(WATCH_TARGET_NAME);
    if (!watchTarget) {
      return config;
    }

    const configurationLists = project.pbxXCConfigurationList();
    const buildConfigurations = project.pbxXCBuildConfigurationSection();
    const configurationList = configurationLists[watchTarget.buildConfigurationList];
    for (const entry of configurationList?.buildConfigurations ?? []) {
      const buildSettings = buildConfigurations[entry.value]?.buildSettings;
      if (!buildSettings) continue;
      delete buildSettings.CODE_SIGN_ENTITLEMENTS;
      delete buildSettings['"CODE_SIGN_ENTITLEMENTS[sdk=iphonesimulator*]"'];
      delete buildSettings['CODE_SIGN_ENTITLEMENTS[sdk=iphonesimulator*]'];
    }

    return config;
  });
}

function addFileReference(project, uuid, fileType, name, filePath) {
  const fileReference = project.hash.project.objects.PBXFileReference;
  fileReference[uuid] = {
    isa: 'PBXFileReference',
    lastKnownFileType: fileType,
    name,
    path: filePath,
    sourceTree: '"<group>"',
  };
  fileReference[`${uuid}_comment`] = name;
}

function addBuildFile(project, uuid, fileRef, comment) {
  const buildFiles = project.hash.project.objects.PBXBuildFile;
  buildFiles[uuid] = {
    isa: 'PBXBuildFile',
    fileRef,
  };
  buildFiles[`${uuid}_comment`] = comment;
}

function makeBuildConfiguration(name, buildSettings) {
  const cleanBuildSettings = {};
  Object.entries(buildSettings).forEach(([key, value]) => {
    if (value !== undefined && value !== null) {
      cleanBuildSettings[key] = value;
    }
  });

  return {
    isa: 'XCBuildConfiguration',
    buildSettings: cleanBuildSettings,
    name,
  };
}

function getAppBuildSettings(project, appTarget) {
  const configurationLists = project.pbxXCConfigurationList();
  const buildConfigurations = project.pbxXCBuildConfigurationSection();
  const configurationList = configurationLists[appTarget.buildConfigurationList];
  const releaseEntry = configurationList?.buildConfigurations?.find((entry) => entry.comment === 'Release')
    ?? configurationList?.buildConfigurations?.[0];
  return releaseEntry ? buildConfigurations[releaseEntry.value]?.buildSettings ?? {} : {};
}

function getBundleIdentifier(project, appTarget) {
  return getAppBuildSettings(project, appTarget).PRODUCT_BUNDLE_IDENTIFIER;
}

function stripQuotes(value) {
  if (typeof value !== 'string') return value;
  return value.replace(/^"|"$/g, '');
}

module.exports = function withWatchOS(config) {
  config = withWatchBridgeSource(config);
  config = withWatchBridgeHeader(config);
  config = withWatchFiles(config);
  config = withWatchXcodeProject(config);
  config = withWatchSigningCleanup(config);
  return config;
};
