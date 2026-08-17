const {
  withDangerousMod,
  withFinalizedMod,
  withXcodeProject,
} = require('@expo/config-plugins');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { withBuildSourceFile } = require('@expo/config-plugins/build/ios/XcodeProjectFile');

const WATCH_TARGET_NAME = 'ClawVoice Watch App';
const WATCH_PRODUCT_NAME = 'ClawVoiceWatch';
const WATCH_FOLDER = 'ClawVoiceWatch';
const WATCH_INFO_FILE = 'WatchInfo.plist';
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
  private static var latestConfiguration: [String: Any] = [:]

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
    sendApplicationContext()
  }

  @objc(setConfiguration:)
  func setConfiguration(_ configuration: NSDictionary) {
    var next: [String: Any] = [:]
    configuration.forEach { key, value in
      if let key = key as? String {
        next[key] = value
      }
    }
    WatchBridge.latestConfiguration = next
    sendApplicationContext()
  }

  private func configureSession() {
    guard WCSession.isSupported() else {
      return
    }

    let session = WCSession.default
    session.delegate = self
    session.activate()
  }

  private func currentPayload() -> [String: Any] {
    var payload: [String: Any] = ["status": WatchBridge.latestStatus]
    if !WatchBridge.latestConfiguration.isEmpty {
      payload["configuration"] = WatchBridge.latestConfiguration
    }
    return payload
  }

  private func sendApplicationContext() {
    guard WCSession.isSupported() else {
      return
    }

    let payload = currentPayload()
    do {
      try WCSession.default.updateApplicationContext(payload)
    } catch {
      NSLog("[ClawVoice Watch] Failed to update application context: \\(error.localizedDescription)")
    }

    if WCSession.default.isReachable {
      WCSession.default.sendMessage(payload, replyHandler: nil) { error in
        NSLog("[ClawVoice Watch] Failed to send live status: \\(error.localizedDescription)")
      }
    }
  }

  private func receiveCommand(_ message: [String: Any], replyHandler: (([String: Any]) -> Void)? = nil) {
    if let command = message["command"] as? String, command == "requestStatus" {
      replyHandler?(currentPayload())
      return
    }

    guard let action = message["action"] as? String else {
      var payload = currentPayload()
      payload["error"] = "missing_action"
      replyHandler?(payload)
      return
    }

    let allowedActions = ["startVoice", "pauseVoice", "stopAudio", "requestStatus"]
    guard allowedActions.contains(action) else {
      var payload = currentPayload()
      payload["error"] = "unsupported_action"
      replyHandler?(payload)
      return
    }

    if action == "requestStatus" {
      replyHandler?(currentPayload())
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

    replyHandler?(currentPayload())
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
RCT_EXTERN_METHOD(setConfiguration:(NSDictionary *)configuration)
@end
`;

const watchAppSwift = `import SwiftUI

@main
struct ClawVoiceWatchApp: App {
  @StateObject private var session = WatchSession()
  @StateObject private var conversation = WatchConversationModel()

  var body: some Scene {
    WindowGroup {
      ContentView()
        .environmentObject(session)
        .environmentObject(conversation)
    }
  }
}
`;

const watchSessionSwift = `import AVFoundation
import Combine
import CryptoKit
import Foundation
import Security
import WatchConnectivity
import WatchKit

struct WatchConfiguration: Codable, Equatable {
  let gatewayUrl: String
  let gatewayToken: String
  let elevenLabsKey: String?
  let languageCode: String
  let locale: String

  var isReady: Bool {
    !gatewayUrl.isEmpty && !gatewayToken.isEmpty
  }

  init?(dictionary: [String: Any]) {
    guard
      let gatewayUrl = dictionary["gatewayUrl"] as? String,
      let gatewayToken = dictionary["gatewayToken"] as? String,
      !gatewayUrl.isEmpty,
      !gatewayToken.isEmpty
    else {
      return nil
    }

    self.gatewayUrl = gatewayUrl
    self.gatewayToken = gatewayToken
    self.elevenLabsKey = (dictionary["elevenLabsKey"] as? String)?.nilIfEmpty
    self.languageCode = (dictionary["languageCode"] as? String)?.nilIfEmpty ?? "en"
    self.locale = (dictionary["locale"] as? String)?.nilIfEmpty ?? "en-US"
  }
}

private extension String {
  var nilIfEmpty: String? {
    isEmpty ? nil : self
  }
}

enum WatchKeychain {
  private static let service = "com.clawvoice.watch"

  static func data(for account: String) -> Data? {
    let query: [String: Any] = [
      kSecClass as String: kSecClassGenericPassword,
      kSecAttrService as String: service,
      kSecAttrAccount as String: account,
      kSecReturnData as String: true,
      kSecMatchLimit as String: kSecMatchLimitOne,
    ]
    var item: CFTypeRef?
    guard SecItemCopyMatching(query as CFDictionary, &item) == errSecSuccess else {
      return nil
    }
    return item as? Data
  }

  static func set(_ data: Data, for account: String) throws {
    let query: [String: Any] = [
      kSecClass as String: kSecClassGenericPassword,
      kSecAttrService as String: service,
      kSecAttrAccount as String: account,
    ]
    SecItemDelete(query as CFDictionary)
    var item = query
    item[kSecValueData as String] = data
    item[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
    let status = SecItemAdd(item as CFDictionary, nil)
    guard status == errSecSuccess else {
      throw WatchConversationError.security("Could not save Watch credentials (\\(status)).")
    }
  }

  static func delete(_ account: String) {
    let query: [String: Any] = [
      kSecClass as String: kSecClassGenericPassword,
      kSecAttrService as String: service,
      kSecAttrAccount as String: account,
    ]
    SecItemDelete(query as CFDictionary)
  }
}

enum WatchConfigurationStore {
  private static let account = "configuration-v1"

  static func load() -> WatchConfiguration? {
    guard let data = WatchKeychain.data(for: account) else { return nil }
    return try? JSONDecoder().decode(WatchConfiguration.self, from: data)
  }

  static func save(_ configuration: WatchConfiguration) {
    guard let data = try? JSONEncoder().encode(configuration) else { return }
    try? WatchKeychain.set(data, for: account)
  }

  static func clear() {
    WatchKeychain.delete(account)
  }
}

final class WatchSession: NSObject, ObservableObject, WCSessionDelegate {
  @Published var status = VoiceStatus.ready
  @Published var reachable = false
  @Published var lastError: String?
  @Published var configuration = WatchConfigurationStore.load()

  override init() {
    super.init()
    guard WCSession.isSupported() else { return }
    let session = WCSession.default
    session.delegate = self
    session.activate()
  }

  func requestStatus() {
    guard WCSession.isSupported(), WCSession.default.activationState == .activated else { return }
    if WCSession.default.isReachable {
      WCSession.default.sendMessage(["command": "requestStatus"], replyHandler: { [weak self] reply in
        self?.apply(reply)
      }, errorHandler: nil)
    }
  }

  func startPhoneFallback() {
    guard WCSession.isSupported(), WCSession.default.isReachable else {
      DispatchQueue.main.async {
        self.lastError = "Open ClawVoice on iPhone"
      }
      return
    }
    WCSession.default.sendMessage(["action": "startVoice"], replyHandler: { [weak self] reply in
      self?.apply(reply)
    }, errorHandler: { [weak self] error in
      DispatchQueue.main.async {
        self?.lastError = error.localizedDescription
      }
    })
  }

  private func apply(_ message: [String: Any]) {
    DispatchQueue.main.async {
      if let rawStatus = message["status"] as? [String: Any] {
        self.status = VoiceStatus(dictionary: rawStatus)
      }
      if let rawConfiguration = message["configuration"] as? [String: Any],
         rawConfiguration["clear"] as? Bool == true {
        self.configuration = nil
        WatchConfigurationStore.clear()
      } else if let rawConfiguration = message["configuration"] as? [String: Any],
                let configuration = WatchConfiguration(dictionary: rawConfiguration) {
          self.configuration = configuration
          WatchConfigurationStore.save(configuration)
      }
      self.reachable = WCSession.default.isReachable
      self.lastError = nil
    }
  }

  func session(_ session: WCSession, activationDidCompleteWith activationState: WCSessionActivationState, error: Error?) {
    DispatchQueue.main.async {
      self.reachable = activationState == .activated && session.isReachable
      self.lastError = error?.localizedDescription
      if activationState == .activated {
        self.requestStatus()
      }
    }
  }

  func sessionReachabilityDidChange(_ session: WCSession) {
    DispatchQueue.main.async {
      self.reachable = session.isReachable
      if session.isReachable { self.requestStatus() }
    }
  }

  func session(_ session: WCSession, didReceiveApplicationContext applicationContext: [String: Any]) {
    apply(applicationContext)
  }

  func session(_ session: WCSession, didReceiveMessage message: [String: Any]) {
    apply(message)
  }
}

struct VoiceStatus {
  let state: String
  let title: String
  let subtitle: String

  static let ready = VoiceStatus(state: "ready", title: "Ready", subtitle: "Tap to talk")

  init(dictionary: [String: Any]) {
    state = dictionary["state"] as? String ?? "ready"
    title = dictionary["title"] as? String ?? "Ready"
    subtitle = dictionary["subtitle"] as? String ?? "Tap to talk"
  }

  private init(state: String, title: String, subtitle: String) {
    self.state = state
    self.title = title
    self.subtitle = subtitle
  }
}

enum WatchConversationError: LocalizedError {
  case configuration(String)
  case microphone(String)
  case network(String)
  case gateway(String)
  case security(String)

  var errorDescription: String? {
    switch self {
    case .configuration(let message), .microphone(let message), .network(let message),
         .gateway(let message), .security(let message):
      return message
    }
  }
}

private struct WatchDeviceIdentity {
  let id: String
  let publicKey: String
  let privateKey: Curve25519.Signing.PrivateKey

  static func loadOrCreate() throws -> WatchDeviceIdentity {
    let account = "gateway-signing-key-v1"
    let privateKey: Curve25519.Signing.PrivateKey
    if let data = WatchKeychain.data(for: account) {
      privateKey = try Curve25519.Signing.PrivateKey(rawRepresentation: data)
    } else {
      privateKey = Curve25519.Signing.PrivateKey()
      try WatchKeychain.set(privateKey.rawRepresentation, for: account)
    }
    let publicData = privateKey.publicKey.rawRepresentation
    let digest = SHA256.hash(data: publicData)
    let id = digest.map { String(format: "%02x", $0) }.joined()
    return WatchDeviceIdentity(id: id, publicKey: publicData.base64URLEncodedString(), privateKey: privateKey)
  }
}

private extension Data {
  func base64URLEncodedString() -> String {
    base64EncodedString()
      .replacingOccurrences(of: "+", with: "-")
      .replacingOccurrences(of: "/", with: "_")
      .replacingOccurrences(of: "=", with: "")
  }

  mutating func appendUTF8(_ string: String) {
    append(contentsOf: string.utf8)
  }
}

actor WatchGatewayClient {
  private var socket: URLSessionWebSocketTask?
  private var configuration: WatchConfiguration?
  private var connectRequestId: String?
  private var chatRequestId: String?
  private var connectContinuation: CheckedContinuation<Void, Error>?
  private var replyContinuation: CheckedContinuation<String, Error>?
  private var streamedReply = ""

  func sendTurn(_ text: String, configuration: WatchConfiguration) async throws -> String {
    self.configuration = configuration
    try await connect()
    return try await awaitReply(afterSending: text)
  }

  func disconnect() {
    socket?.cancel(with: .normalClosure, reason: nil)
    socket = nil
    failPending(WatchConversationError.network("Watch conversation ended."))
  }

  private func connect() async throws {
    guard let configuration, let url = URL(string: configuration.gatewayUrl) else {
      throw WatchConversationError.configuration("The gateway URL is invalid.")
    }

    var request = URLRequest(url: url)
    request.timeoutInterval = 15
    if let origin = Self.origin(for: url) {
      request.setValue(origin, forHTTPHeaderField: "Origin")
    }
    let socket = URLSession.shared.webSocketTask(with: request)
    self.socket = socket
    socket.resume()
    Task { await receiveLoop() }

    try await withCheckedThrowingContinuation { continuation in
      connectContinuation = continuation
      Task {
        try? await Task.sleep(nanoseconds: 15_000_000_000)
        connectTimedOut()
      }
    }
  }

  private func awaitReply(afterSending text: String) async throws -> String {
    try await withCheckedThrowingContinuation { continuation in
      replyContinuation = continuation
      streamedReply = ""
      Task { await sendChat(text) }
      Task {
        try? await Task.sleep(nanoseconds: 60_000_000_000)
        replyTimedOut()
      }
    }
  }

  private func receiveLoop() async {
    do {
      while let socket {
        let message = try await socket.receive()
        switch message {
        case .string(let raw):
          await handle(raw)
        case .data(let data):
          if let raw = String(data: data, encoding: .utf8) { await handle(raw) }
        @unknown default:
          break
        }
      }
    } catch {
      failPending(WatchConversationError.network(error.localizedDescription))
    }
  }

  private func handle(_ raw: String) async {
    guard
      let data = raw.data(using: .utf8),
      let frame = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
      let type = frame["type"] as? String
    else { return }

    if type == "event", let event = frame["event"] as? String {
      let payload = (frame["payload"] as? [String: Any]) ?? (frame["data"] as? [String: Any]) ?? [:]
      if event == "connect.challenge", let nonce = payload["nonce"] as? String {
        await answerChallenge(nonce)
        return
      }
      handleEvent(event, payload: payload)
      return
    }

    guard type == "res", let id = frame["id"] as? String else { return }
    let ok = frame["ok"] as? Bool ?? false
    if id == connectRequestId {
      if ok {
        if let configuration,
           let payload = frame["payload"] as? [String: Any],
           let auth = payload["auth"] as? [String: Any],
           let deviceToken = auth["deviceToken"] as? String,
           let data = deviceToken.data(using: .utf8) {
          try? WatchKeychain.set(data, for: Self.deviceTokenAccount(configuration.gatewayUrl))
        }
        connectContinuation?.resume()
      } else {
        connectContinuation?.resume(throwing: Self.gatewayError(from: frame))
      }
      connectContinuation = nil
      return
    }
    if id == chatRequestId, !ok {
      finishReply(.failure(Self.gatewayError(from: frame)))
    }
  }

  private func answerChallenge(_ nonce: String) async {
    guard socket != nil, let configuration else { return }
    do {
      let identity = try WatchDeviceIdentity.loadOrCreate()
      let signedAt = Int64(Date().timeIntervalSince1970 * 1000)
      let scopes = ["operator.read", "operator.write"]
      let signPayload = [
        "v2", identity.id, "openclaw-control-ui", "ui", "operator",
        scopes.joined(separator: ","), String(signedAt), configuration.gatewayToken, nonce,
      ].joined(separator: "|")
      let signature = try identity.privateKey.signature(for: Data(signPayload.utf8)).base64URLEncodedString()
      let id = Self.nextId("connect")
      connectRequestId = id
      var auth: [String: Any] = ["token": configuration.gatewayToken]
      if let data = WatchKeychain.data(for: Self.deviceTokenAccount(configuration.gatewayUrl)),
         let deviceToken = String(data: data, encoding: .utf8),
         !deviceToken.isEmpty {
        auth["deviceToken"] = deviceToken
      }
      let params: [String: Any] = [
        "minProtocol": 3,
        "maxProtocol": 4,
        "client": ["id": "openclaw-control-ui", "version": "3.1.0", "platform": "web", "mode": "ui"],
        "role": "operator",
        "scopes": scopes,
        "caps": ["voice"],
        "commands": [],
        "permissions": [:],
        "auth": auth,
        "locale": configuration.locale,
        "userAgent": "clawvoice-watch/3.1.0 (watchOS)",
        "device": [
          "id": identity.id,
          "publicKey": identity.publicKey,
          "signature": signature,
          "signedAt": signedAt,
          "nonce": nonce,
        ],
      ]
      try await send(["type": "req", "id": id, "method": "connect", "params": params])
    } catch {
      connectContinuation?.resume(throwing: error)
      connectContinuation = nil
    }
  }

  private func sendChat(_ text: String) async {
    do {
      let id = Self.nextId("chat")
      chatRequestId = id
      let params: [String: Any] = [
        "message": text,
        "sessionKey": "agent:main:main",
        "idempotencyKey": "clawvoice-watch-\\(UUID().uuidString)",
      ]
      try await send(["type": "req", "id": id, "method": "chat.send", "params": params])
    } catch {
      finishReply(.failure(error))
    }
  }

  private func send(_ frame: [String: Any]) async throws {
    guard let socket else { throw WatchConversationError.network("Gateway is not connected.") }
    let data = try JSONSerialization.data(withJSONObject: frame)
    guard let text = String(data: data, encoding: .utf8) else {
      throw WatchConversationError.network("Could not encode the gateway request.")
    }
    try await socket.send(.string(text))
  }

  private func handleEvent(_ event: String, payload: [String: Any]) {
    if event == "agent" {
      let stream = payload["stream"] as? String ?? ""
      let data = payload["data"] as? [String: Any] ?? [:]
      if stream == "assistant", let delta = data["delta"] as? String {
        streamedReply += delta
      }
      return
    }

    if event == "chat" {
      let state = payload["state"] as? String ?? ""
      if state == "delta" {
        streamedReply += (payload["deltaText"] as? String)
          ?? (payload["delta"] as? String)
          ?? (payload["text"] as? String)
          ?? ""
      } else if state == "final" {
        let text = Self.extractText(payload["message"]) ?? (payload["text"] as? String) ?? streamedReply
        if !text.isEmpty { finishReply(.success(text)) }
      } else if state == "error" || state == "aborted" {
        finishReply(.failure(WatchConversationError.gateway(payload["error"] as? String ?? "Agent request failed.")))
      }
      return
    }

    if event == "session.message",
       let message = (payload["message"] as? [String: Any]) ?? Optional(payload),
       message["role"] as? String == "assistant",
       let text = Self.extractText(message),
       !text.isEmpty {
      finishReply(.success(text))
    }
  }

  private func finishReply(_ result: Result<String, Error>) {
    guard let continuation = replyContinuation else { return }
    replyContinuation = nil
    continuation.resume(with: result)
  }

  private func failPending(_ error: Error) {
    if let continuation = connectContinuation {
      connectContinuation = nil
      continuation.resume(throwing: error)
    }
    if let continuation = replyContinuation {
      replyContinuation = nil
      continuation.resume(throwing: error)
    }
  }

  private func connectTimedOut() {
    guard let continuation = connectContinuation else { return }
    connectContinuation = nil
    continuation.resume(throwing: WatchConversationError.network("Gateway connection timed out."))
    socket?.cancel(with: .goingAway, reason: nil)
  }

  private func replyTimedOut() {
    guard replyContinuation != nil else { return }
    finishReply(.failure(WatchConversationError.network("The agent response timed out.")))
  }

  private static func gatewayError(from frame: [String: Any]) -> Error {
    let error = frame["error"] as? [String: Any] ?? [:]
    let message = error["message"] as? String ?? "Gateway rejected the request."
    let normalized = message.lowercased()
    if normalized.contains("pair") || normalized.contains("approve") || normalized.contains("device") {
      return WatchConversationError.gateway("Approve this Watch in OpenClaw, then try again.")
    }
    return WatchConversationError.gateway(message)
  }

  private static func extractText(_ value: Any?) -> String? {
    guard let message = value as? [String: Any] else { return value as? String }
    if let text = message["text"] as? String { return text }
    if let text = message["content"] as? String { return text }
    guard let content = message["content"] as? [Any] else { return nil }
    return content.compactMap { part -> String? in
      if let text = part as? String { return text }
      guard let record = part as? [String: Any] else { return nil }
      return (record["text"] as? String) ?? (record["content"] as? String)
    }.joined()
  }

  private static func nextId(_ prefix: String) -> String {
    "watch-\\(prefix)-\\(UUID().uuidString)"
  }

  private static func deviceTokenAccount(_ gatewayUrl: String) -> String {
    let digest = SHA256.hash(data: Data(gatewayUrl.utf8))
    return "gateway-device-token-" + digest.prefix(8).map { String(format: "%02x", $0) }.joined()
  }

  private static func origin(for url: URL) -> String? {
    guard let host = url.host else { return nil }
    let scheme = url.scheme == "wss" ? "https" : "http"
    let port = url.port.map { ":\\($0)" } ?? ""
    return "\\(scheme)://\\(host)\\(port)"
  }
}

enum WatchTranscriber {
  static func transcribe(fileURL: URL, apiKey: String, languageCode: String) async throws -> String {
    let boundary = "ClawVoice-\\(UUID().uuidString)"
    var body = Data()
    body.appendUTF8("--\\(boundary)\\r\\n")
    body.appendUTF8("Content-Disposition: form-data; name=\\\"model_id\\\"\\r\\n\\r\\n")
    body.appendUTF8("scribe_v1\\r\\n")
    if !languageCode.isEmpty {
      body.appendUTF8("--\\(boundary)\\r\\n")
      body.appendUTF8("Content-Disposition: form-data; name=\\\"language_code\\\"\\r\\n\\r\\n")
      body.appendUTF8("\\(languageCode)\\r\\n")
    }
    body.appendUTF8("--\\(boundary)\\r\\n")
    body.appendUTF8("Content-Disposition: form-data; name=\\\"file\\\"; filename=\\\"watch-speech.m4a\\\"\\r\\n")
    body.appendUTF8("Content-Type: audio/m4a\\r\\n\\r\\n")
    body.append(try Data(contentsOf: fileURL))
    body.appendUTF8("\\r\\n--\\(boundary)--\\r\\n")

    var request = URLRequest(url: URL(string: "https://api.elevenlabs.io/v1/speech-to-text")!)
    request.httpMethod = "POST"
    request.timeoutInterval = 30
    request.setValue(apiKey, forHTTPHeaderField: "xi-api-key")
    request.setValue("multipart/form-data; boundary=\\(boundary)", forHTTPHeaderField: "Content-Type")
    let (data, response) = try await URLSession.shared.upload(for: request, from: body)
    guard let http = response as? HTTPURLResponse else {
      throw WatchConversationError.network("Transcription returned no response.")
    }
    let payload = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] ?? [:]
    guard (200..<300).contains(http.statusCode) else {
      let detail = payload["detail"] as? String
      throw WatchConversationError.network(detail ?? "Transcription failed (HTTP \\(http.statusCode)).")
    }
    let text = ((payload["text"] as? String) ?? (payload["transcript"] as? String) ?? "")
      .trimmingCharacters(in: .whitespacesAndNewlines)
    guard !text.isEmpty else {
      throw WatchConversationError.microphone("I could not hear clear speech.")
    }
    return text
  }
}

enum WatchConversationPhase: String {
  case ready
  case listening
  case transcribing
  case thinking
  case speaking
  case error
}

@MainActor
final class WatchConversationModel: NSObject, ObservableObject, AVSpeechSynthesizerDelegate {
  @Published var phase: WatchConversationPhase = .ready
  @Published var title = "Ready"
  @Published var subtitle = "Tap to talk"
  @Published var transcript = ""
  @Published var reply = ""
  @Published var autoContinue = true

  private var configuration: WatchConfiguration?
  private var recorder: AVAudioRecorder?
  private var recordingURL: URL?
  private var monitorTask: Task<Void, Never>?
  private var requestTask: Task<Void, Never>?
  private var followUpTask: Task<Void, Never>?
  private var gateway: WatchGatewayClient?
  private let synthesizer = AVSpeechSynthesizer()
  private var appIsActive = true
  private var heardSpeech = false
  private var silenceStartedAt: Date?
  private var recordingStartedAt = Date()
  private var automaticFollowUp = false
  private var followUpDeadline: Date?

  override init() {
    super.init()
    synthesizer.delegate = self
  }

  func configure(_ configuration: WatchConfiguration?) {
    self.configuration = configuration
    guard configuration != nil else {
      phase = .error
      title = "Setup needed"
      subtitle = "Open ClawVoice on iPhone"
      return
    }
    if phase == .error {
      resetToReady()
    }
  }

  func setAppActive(_ active: Bool) {
    appIsActive = active
    if !active {
      followUpTask?.cancel()
      if phase == .listening { cancelRecording(showReady: true) }
    }
  }

  func togglePrimaryAction() {
    switch phase {
    case .listening:
      finishRecording()
    case .transcribing, .thinking:
      cancelCurrentTurn()
    case .speaking:
      synthesizer.stopSpeaking(at: .immediate)
      resetToReady()
    case .ready, .error:
      followUpDeadline = Date().addingTimeInterval(60)
      automaticFollowUp = false
      Task { await startRecording() }
    }
  }

  func cancelCurrentTurn() {
    monitorTask?.cancel()
    requestTask?.cancel()
    followUpTask?.cancel()
    recorder?.stop()
    recorder = nil
    let currentGateway = gateway
    gateway = nil
    Task { await currentGateway?.disconnect() }
    synthesizer.stopSpeaking(at: .immediate)
    resetToReady()
  }

  private func startRecording() async {
    guard appIsActive else { return }
    guard let configuration, configuration.isReady else {
      phase = .error
      title = "Setup needed"
      subtitle = "Open ClawVoice on iPhone"
      return
    }

    guard configuration.elevenLabsKey?.isEmpty == false else {
      presentSystemDictation(configuration: configuration)
      return
    }
    let allowed = await requestMicrophonePermission()
    guard allowed else {
      showError("Microphone permission is required.")
      return
    }

    do {
      let session = AVAudioSession.sharedInstance()
      try session.setCategory(.record, mode: .measurement)
      try session.setActive(true)
      let url = FileManager.default.temporaryDirectory.appendingPathComponent("watch-turn-\\(UUID().uuidString).m4a")
      let settings: [String: Any] = [
        AVFormatIDKey: kAudioFormatMPEG4AAC,
        AVSampleRateKey: 16_000,
        AVNumberOfChannelsKey: 1,
        AVEncoderBitRateKey: 32_000,
        AVEncoderAudioQualityKey: AVAudioQuality.medium.rawValue,
      ]
      let recorder = try AVAudioRecorder(url: url, settings: settings)
      recorder.isMeteringEnabled = true
      guard recorder.prepareToRecord(), recorder.record(forDuration: 20) else {
        throw WatchConversationError.microphone("Could not start the Watch microphone.")
      }
      self.recorder = recorder
      recordingURL = url
      heardSpeech = false
      silenceStartedAt = nil
      recordingStartedAt = Date()
      phase = .listening
      title = "Listening"
      subtitle = "Speak now"
      transcript = ""
      WKInterfaceDevice.current().play(.start)
      beginVoiceActivityMonitoring()
    } catch {
      showError(error.localizedDescription)
    }
  }

  private func requestMicrophonePermission() async -> Bool {
    await withCheckedContinuation { continuation in
      AVAudioApplication.requestRecordPermission { allowed in
        continuation.resume(returning: allowed)
      }
    }
  }

  private func presentSystemDictation(configuration: WatchConfiguration) {
    guard let controller = WKApplication.shared().visibleInterfaceController else {
      showError("Dictation is unavailable. Try again.")
      return
    }
    phase = .listening
    title = "Dictate"
    subtitle = "Use the Watch dictation microphone"
    controller.presentTextInputController(withSuggestions: nil, allowedInputMode: .plain) { [weak self] results in
      Task { @MainActor in
        guard let self else { return }
        guard
          let text = results?.first as? String,
          !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        else {
          self.resetToReady()
          return
        }
        let utterance = text.trimmingCharacters(in: .whitespacesAndNewlines)
        self.transcript = utterance
        self.phase = .thinking
        self.title = "Thinking"
        self.subtitle = utterance
        self.requestTask?.cancel()
        self.requestTask = Task { @MainActor in
          do {
            let gateway = WatchGatewayClient()
            self.gateway = gateway
            let response = try await gateway.sendTurn(utterance, configuration: configuration)
            await gateway.disconnect()
            self.gateway = nil
            guard !Task.isCancelled else { return }
            self.reply = response.trimmingCharacters(in: .whitespacesAndNewlines)
            self.speakReply(self.reply)
          } catch is CancellationError {
            self.resetToReady()
          } catch {
            self.showError(error.localizedDescription)
          }
        }
      }
    }
  }

  private func beginVoiceActivityMonitoring() {
    monitorTask?.cancel()
    monitorTask = Task { @MainActor in
      while !Task.isCancelled, phase == .listening, let recorder {
        try? await Task.sleep(nanoseconds: 100_000_000)
        recorder.updateMeters()
        let level = recorder.averagePower(forChannel: 0)
        let elapsed = Date().timeIntervalSince(recordingStartedAt)

        if level > -37 {
          heardSpeech = true
          silenceStartedAt = nil
        } else if heardSpeech && level < -43 {
          if silenceStartedAt == nil { silenceStartedAt = Date() }
          if elapsed > 0.9, Date().timeIntervalSince(silenceStartedAt!) >= 1.0 {
            finishRecording()
            return
          }
        }

        if !heardSpeech && elapsed >= 6 {
          cancelRecording(showReady: automaticFollowUp)
          if !automaticFollowUp { showError("I could not hear clear speech.") }
          return
        }
        if elapsed >= 20 {
          finishRecording()
          return
        }
      }
    }
  }

  private func finishRecording() {
    guard phase == .listening, let recorder, let recordingURL else { return }
    monitorTask?.cancel()
    self.recorder = nil
    self.recordingURL = nil
    recorder.stop()
    try? AVAudioSession.sharedInstance().setActive(false)
    guard heardSpeech else {
      try? FileManager.default.removeItem(at: recordingURL)
      showError("I could not hear clear speech.")
      return
    }

    phase = .transcribing
    title = "Transcribing"
    subtitle = "Understanding your voice"
    WKInterfaceDevice.current().play(.stop)
    processRecording(recordingURL)
  }

  private func processRecording(_ url: URL) {
    guard let configuration, let apiKey = configuration.elevenLabsKey else {
      try? FileManager.default.removeItem(at: url)
      showError("Enable ElevenLabs STT on iPhone.")
      return
    }

    requestTask?.cancel()
    requestTask = Task { @MainActor in
      defer { try? FileManager.default.removeItem(at: url) }
      do {
        let text = try await WatchTranscriber.transcribe(
          fileURL: url,
          apiKey: apiKey,
          languageCode: configuration.languageCode
        )
        guard !Task.isCancelled else { return }
        transcript = text
        phase = .thinking
        title = "Thinking"
        subtitle = text
        let gateway = WatchGatewayClient()
        self.gateway = gateway
        let response = try await gateway.sendTurn(text, configuration: configuration)
        await gateway.disconnect()
        self.gateway = nil
        guard !Task.isCancelled else { return }
        reply = response.trimmingCharacters(in: .whitespacesAndNewlines)
        speakReply(reply)
      } catch is CancellationError {
        resetToReady()
      } catch {
        showError(error.localizedDescription)
      }
    }
  }

  private func speakReply(_ text: String) {
    guard !text.isEmpty else {
      showError("The agent returned an empty response.")
      return
    }
    do {
      let session = AVAudioSession.sharedInstance()
      try session.setCategory(.playback, mode: .spokenAudio)
      try session.setActive(true)
    } catch {
      showError("Could not play the Watch response.")
      return
    }
    phase = .speaking
    title = "Speaking"
    subtitle = text
    let utterance = AVSpeechUtterance(string: Self.spokenExcerpt(text))
    utterance.voice = AVSpeechSynthesisVoice(language: configuration?.locale)
    utterance.rate = 0.5
    synthesizer.speak(utterance)
    WKInterfaceDevice.current().play(.success)
  }

  nonisolated func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didFinish utterance: AVSpeechUtterance) {
    Task { @MainActor in self.speechFinished() }
  }

  nonisolated func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didCancel utterance: AVSpeechUtterance) {
    Task { @MainActor in self.speechFinished(allowFollowUp: false) }
  }

  private func speechFinished(allowFollowUp: Bool = true) {
    try? AVAudioSession.sharedInstance().setActive(false)
    phase = .ready
    title = "Ready"
    subtitle = "Tap to continue"
    guard
      allowFollowUp,
      autoContinue,
      appIsActive,
      configuration?.elevenLabsKey?.isEmpty == false,
      let followUpDeadline,
      Date() < followUpDeadline
    else { return }

    followUpTask?.cancel()
    followUpTask = Task { @MainActor in
      try? await Task.sleep(nanoseconds: 1_200_000_000)
      guard !Task.isCancelled, appIsActive, phase == .ready else { return }
      automaticFollowUp = true
      await startRecording()
    }
  }

  private func cancelRecording(showReady: Bool) {
    monitorTask?.cancel()
    recorder?.stop()
    recorder = nil
    if let recordingURL { try? FileManager.default.removeItem(at: recordingURL) }
    recordingURL = nil
    try? AVAudioSession.sharedInstance().setActive(false)
    if showReady { resetToReady() }
  }

  private func resetToReady() {
    phase = .ready
    title = "Ready"
    subtitle = "Tap to talk"
    automaticFollowUp = false
  }

  private func showError(_ message: String) {
    phase = .error
    title = "Try again"
    subtitle = Self.short(message, limit: 80)
    WKInterfaceDevice.current().play(.failure)
  }

  private static func spokenExcerpt(_ text: String) -> String {
    let compact = text.replacingOccurrences(of: "\\n", with: " ")
    return short(compact, limit: 700)
  }

  private static func short(_ text: String, limit: Int) -> String {
    guard text.count > limit else { return text }
    return String(text.prefix(limit)).trimmingCharacters(in: .whitespacesAndNewlines) + "…"
  }
}
`;

const contentViewSwift = `import SwiftUI

struct ContentView: View {
  @EnvironmentObject private var session: WatchSession
  @EnvironmentObject private var conversation: WatchConversationModel
  @Environment(\\.scenePhase) private var scenePhase

  var body: some View {
    ScrollView {
      VStack(spacing: 9) {
        Image(systemName: symbolName)
          .font(.system(size: 27, weight: .semibold))
          .foregroundStyle(accentColor)

        Text(conversation.title)
          .font(.headline)
          .multilineTextAlignment(.center)
          .lineLimit(2)
          .minimumScaleFactor(0.72)

        Text(conversation.subtitle)
          .font(.caption2)
          .foregroundStyle(.secondary)
          .multilineTextAlignment(.center)
          .lineLimit(3)
          .minimumScaleFactor(0.68)

        Button {
          conversation.togglePrimaryAction()
        } label: {
          Label(primaryTitle, systemImage: primarySymbol)
            .lineLimit(1)
            .minimumScaleFactor(0.75)
        }
        .buttonStyle(.borderedProminent)
        .tint(accentColor)

        if (conversation.phase == .ready || conversation.phase == .error)
          && session.configuration?.elevenLabsKey?.isEmpty == false {
          Toggle("Follow-ups", isOn: $conversation.autoContinue)
            .font(.caption2)
        }

        if session.configuration?.isReady != true && session.reachable {
          Button("Use iPhone") {
            session.startPhoneFallback()
          }
          .font(.caption2)
        }
      }
      .frame(maxWidth: .infinity)
      .padding(.horizontal, 8)
      .padding(.vertical, 6)
    }
    .onAppear {
      conversation.configure(session.configuration)
      conversation.setAppActive(scenePhase == .active)
      session.requestStatus()
    }
    .onChange(of: session.configuration) { _, configuration in
      conversation.configure(configuration)
    }
    .onChange(of: scenePhase) { _, phase in
      conversation.setAppActive(phase == .active)
    }
  }

  private var primaryTitle: String {
    switch conversation.phase {
    case .listening:
      return "Send"
    case .transcribing, .thinking, .speaking:
      return "Stop"
    default:
      return "Talk"
    }
  }

  private var primarySymbol: String {
    switch conversation.phase {
    case .listening:
      return "paperplane.circle.fill"
    case .transcribing, .thinking, .speaking:
      return "stop.circle.fill"
    default:
      return "mic.circle.fill"
    }
  }

  private var symbolName: String {
    switch conversation.phase {
    case .listening:
      return "waveform.circle"
    case .transcribing:
      return "text.bubble"
    case .thinking:
      return "ellipsis.circle"
    case .speaking:
      return "speaker.wave.2.circle"
    case .error:
      return "exclamationmark.circle"
    default:
      return "mic.circle"
    }
  }

  private var accentColor: Color {
    switch conversation.phase {
    case .listening, .speaking:
      return .green
    case .transcribing, .thinking:
      return .orange
    case .error:
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
      fs.writeFileSync(path.join(watchRoot, WATCH_INFO_FILE), makeWatchInfoPlist(config.ios?.bundleIdentifier));
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
  <key>WKRunsIndependentlyOfCompanionApp</key>
  <true/>
  <key>WKApplication</key>
  <true/>
  <key>NSMicrophoneUsageDescription</key>
  <string>ClawVoice records short voice turns so you can talk to your OpenClaw agent from Apple Watch.</string>
  <key>UIBackgroundModes</key>
  <array>
    <string>audio</string>
  </array>
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

    const appBundleId = stripQuotes(getBundleIdentifier(project, appTarget) || config.ios?.bundleIdentifier);
    const watchBundleId = `${appBundleId}${WATCH_BUNDLE_SUFFIX}`;
    const existingWatchTarget = project.pbxTargetByName(WATCH_TARGET_NAME);
    if (existingWatchTarget) {
      migrateWatchInfoReference(project);
      updateWatchBuildSettings(project, existingWatchTarget, appTarget, watchBundleId);
      return config;
    }

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
    addFileReference(project, watchInfoFileId, 'text.plist.xml', WATCH_INFO_FILE, `${WATCH_FOLDER}/${WATCH_INFO_FILE}`);
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
        { value: watchInfoFileId, comment: WATCH_INFO_FILE },
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
      CODE_SIGN_STYLE: baseBuildSettings.CODE_SIGN_STYLE || 'Automatic',
      CURRENT_PROJECT_VERSION: baseBuildSettings.CURRENT_PROJECT_VERSION || '1',
      DEVELOPMENT_TEAM: baseBuildSettings.DEVELOPMENT_TEAM,
      GENERATE_INFOPLIST_FILE: 'NO',
      INFOPLIST_FILE: `${WATCH_FOLDER}/${WATCH_INFO_FILE}`,
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

function migrateWatchInfoReference(project) {
  const objects = project.hash.project.objects;
  const fileReferences = objects.PBXFileReference || {};
  const oldPath = `${WATCH_FOLDER}/Info.plist`;
  let migratedFileId = null;

  for (const [key, reference] of Object.entries(fileReferences)) {
    if (key.endsWith('_comment') || !reference || typeof reference !== 'object') continue;
    if (stripQuotes(reference.path) !== oldPath) continue;
    reference.name = WATCH_INFO_FILE;
    reference.path = `${WATCH_FOLDER}/${WATCH_INFO_FILE}`;
    fileReferences[`${key}_comment`] = WATCH_INFO_FILE;
    migratedFileId = key;
  }

  if (!migratedFileId) return;
  for (const group of Object.values(objects.PBXGroup || {})) {
    if (!group || typeof group !== 'object' || !Array.isArray(group.children)) continue;
    for (const child of group.children) {
      if (child?.value === migratedFileId) child.comment = WATCH_INFO_FILE;
    }
  }
}

function updateWatchBuildSettings(project, watchTarget, appTarget, watchBundleId) {
  const configurationLists = project.pbxXCConfigurationList();
  const buildConfigurations = project.pbxXCBuildConfigurationSection();
  const configurationList = configurationLists[watchTarget.buildConfigurationList];
  const baseBuildSettings = getAppBuildSettings(project, appTarget);
  if (!configurationList?.buildConfigurations) {
    return;
  }

  for (const entry of configurationList.buildConfigurations) {
    const configuration = buildConfigurations[entry.value];
    if (!configuration?.buildSettings) {
      continue;
    }

    configuration.buildSettings = {
      ...configuration.buildSettings,
      ASSETCATALOG_COMPILER_APPICON_NAME: 'AppIcon',
      CURRENT_PROJECT_VERSION: baseBuildSettings.CURRENT_PROJECT_VERSION || configuration.buildSettings.CURRENT_PROJECT_VERSION || '1',
      GENERATE_INFOPLIST_FILE: 'NO',
      INFOPLIST_FILE: `${WATCH_FOLDER}/${WATCH_INFO_FILE}`,
      MARKETING_VERSION: baseBuildSettings.MARKETING_VERSION || configuration.buildSettings.MARKETING_VERSION || '1.0',
      PRODUCT_BUNDLE_IDENTIFIER: watchBundleId,
      PRODUCT_NAME: `"${WATCH_PRODUCT_NAME}"`,
      SDKROOT: 'watchos',
      SKIP_INSTALL: 'YES',
      SUPPORTED_PLATFORMS: '"watchos watchsimulator"',
      TARGETED_DEVICE_FAMILY: 4,
      WATCHOS_DEPLOYMENT_TARGET: WATCH_DEPLOYMENT_TARGET,
    };
  }
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
      delete buildSettings.SYSTEM_CAPABILITIES;
      delete buildSettings['SystemCapabilities'];
    }

    return config;
  });
}

function withWatchPlistCleanup(config) {
  return withFinalizedMod(config, [
    'ios',
    async (config) => {
      const plistPath = path.join(config.modRequest.platformProjectRoot, WATCH_FOLDER, WATCH_INFO_FILE);
      fs.writeFileSync(plistPath, makeWatchInfoPlist(config.ios?.bundleIdentifier));
      return config;
    },
  ]);
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
  config = withWatchPlistCleanup(config);
  return config;
};
