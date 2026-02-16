# Claw Drive — Technical Research

## Research Date: Feb 16, 2026

---

# 1. OpenClaw Gateway WebSocket Protocol

## Overview
- Central WebSocket RPC server at `ws://127.0.0.1:18789`
- Same port serves WebSocket + HTTP (multiplexed)
- Protocol version: **3**
- Schema defined in TypeBox: `src/gateway/protocol/schema.ts` and `frames.ts`
- JSON Schema available at `dist/protocol.schema.json`

## Frame Types

| Type | Field | Purpose |
|---|---|---|
| `req` | `type: "req"` | Client → Server RPC call |
| `res` | `type: "res"` | Server → Client response |
| `evt` | `type: "event"` | Server-pushed event (streaming, notifications) |

## Connection Handshake

1. Client sends `connect` as first frame
2. Server may send `connect.challenge` (nonce + timestamp)
3. Server responds `hello-ok` with protocol version, policy, and optional `deviceToken`
4. Client persists `deviceToken` for future reconnections

### Connect Frame (iOS Node Example)

```json
{
  "type": "req",
  "id": "...",
  "method": "connect",
  "params": {
    "minProtocol": 3,
    "maxProtocol": 3,
    "client": {
      "id": "ios-node",
      "version": "1.2.3",
      "platform": "ios",
      "mode": "node"
    },
    "role": "node",
    "scopes": [],
    "caps": ["camera", "canvas", "screen", "location", "voice"],
    "commands": ["camera.snap", "canvas.navigate", "screen.record", "location.get"],
    "permissions": { "camera.capture": true, "screen.record": false },
    "auth": { "token": "..." },
    "locale": "en-US",
    "userAgent": "openclaw-ios/1.2.3",
    "device": {
      "id": "device_fingerprint",
      "publicKey": "...",
      "signature": "...",
      "signedAt": 1737264000000,
      "nonce": "..."
    }
  }
}
```

### Hello-OK Response

```json
{
  "type": "res",
  "id": "...",
  "ok": true,
  "payload": {
    "type": "hello-ok",
    "protocol": 3,
    "policy": { "tickIntervalMs": 15000 },
    "auth": {
      "deviceToken": "...",
      "role": "node",
      "scopes": ["..."]
    }
  }
}
```

## Authentication
- Token-based: `OPENCLAW_GATEWAY_TOKEN` env var or `gateway.auth.token` config
- `connect.params.auth.token` must match or socket is closed
- Device tokens can be rotated (`device.token.rotate`) and revoked (`device.token.revoke`)

## RPC Methods

| Category | Methods |
|---|---|
| **Config** | `config.get`, `config.set`, `config.apply`, `config.patch` |
| **Chat** | `chat.send`, `chat.stop` (+ streaming events) |
| **Agent** | `agent.send`, `agent.execute` |
| **Sessions** | `sessions.list`, `sessions.history`, `sessions.send` |
| **Channels** | `channels.status`, `channels.login` |
| **Models** | `models.list` |
| **Nodes** | `node.describe`, `node.invoke` |
| **Device** | `device.token.rotate`, `device.token.revoke` |
| **Approvals** | `exec.approval.resolve` |
| **System** | `gateway.health`, `gateway.status` |

## Node Commands (device-side)

| Command | Description |
|---|---|
| `camera.snap` | Capture photo |
| `camera.list` | List cameras |
| `screen.capture` | Screenshot |
| `screen.record` | Record screen |
| `location.get` | Device location |
| `canvas.present/hide/navigate/eval/snapshot` | Canvas (visual workspace) |
| `canvas.a2ui.push/reset` | Agent-to-UI messaging |
| `system.run` | Execute command (macOS only) |
| `system.notify` | Show notification |

## HTTP Endpoints

| Endpoint | Description |
|---|---|
| `POST /v1/chat/completions` | OpenAI-compatible chat (disabled by default) |
| `POST /v1/responses` | Item-based input with SSE streaming |
| `GET /dashboard/` | Control UI web dashboard |

## iOS App Source Structure

```
apps/ios/Sources/
  Gateway/GatewaySettingsStore.swift
  Model/NodeAppModel.swift
  Services/CalendarService.swift
  Services/ContactsService.swift
  Services/PhotoLibraryService.swift
  Services/MotionService.swift
  Services/RemindersService.swift
apps/shared/OpenClawKit/  -- shared transport/types
```

- Discovers gateways via Bonjour/mDNS (`_openclaw-gw._tcp`)
- Pairs via Telegram setup-code
- Split "node" vs "operator" gateway session model

---

# 2. CarPlay Entitlement

## Current Categories

| Category | Template Depth | Introduced |
|---|---|---|
| Audio | 5 | Original |
| Communication | 5 | Original |
| Navigation | 5 | Original |
| EV Charging | 5 | iOS 14 |
| Fueling | 3 | iOS 16 |
| Driving Task | 2 | iOS 16 |
| Parking | 5 | iOS 16 |
| Quick Food Ordering | 2 | iOS 16 |

**One entitlement per app** (exception: EV Charging + Fueling can combine).

## Which Category for Voice AI?

**None cleanly fits today.** Closest:
- **Driving Task** — too restrictive (depth 2), Apple expects driving-related tasks
- **Communication** — requires SiriKit intents (not what an AI chatbot does)
- **Audio** — Apple expects primary audio playback

## iOS 26.4 — NEW: Third-Party AI Voice Assistants

Apple is opening CarPlay to third-party AI voice apps (Bloomberg, Feb 6, 2026):
- Named providers: OpenAI (ChatGPT), Anthropic (Claude), Google (Gemini)
- Expected: **iOS 26.4** (March-April 2026) or iOS 27
- Users must **manually open the app** (no wake word, no Siri replacement)
- Voice mode can **auto-launch on app open**
- Cannot control vehicle functions or iPhone operations
- **New entitlement category expected** but NOT yet published
- No public API/SDK yet — likely at WWDC 2026 or iOS 26.4 beta

## How to Apply

1. Go to [developer.apple.com/carplay](https://developer.apple.com/carplay)
2. Fill out request form (must be Team Agent)
3. Apple reviews manually
4. Timeline: **days to months** (no official SLA)
5. After approval: create new Provisioning Profile with CarPlay entitlement

## Strategy

- **Now**: Build app, test in CarPlay Simulator (no entitlement needed)
- **Apply early**: For "Driving Task" as stopgap
- **Watch for**: iOS 26.4 beta SDK, WWDC 2026 for new AI voice category

## Available CarPlay Templates

| Template | Purpose |
|---|---|
| `CPListTemplate` | Scrollable list |
| `CPGridTemplate` | Grid of buttons (max 8) |
| `CPTabBarTemplate` | Tab container |
| `CPVoiceControlTemplate` | Voice input indicator |
| `CPNowPlayingTemplate` | Audio playback controls |
| `CPMapTemplate` | Map overlay |
| `CPSearchTemplate` | Search interface |
| `CPInformationTemplate` | Detail view |
| `CPPointOfInterestTemplate` | Location-based content |
| `CPContactTemplate` | Person/business info |
| `CPAlertTemplate` | Modal alert |
| `CPActionSheetTemplate` | Modal action sheet |

---

# 3. React Native Feasibility

## CarPlay + React Native: YES

### Library: `birkir/react-native-carplay`

- **Stars**: ~781, **Contributors**: ~30, **Open Issues**: ~47
- Supports **both CarPlay AND Android Auto**
- TypeScript, supports RN New Architecture (Fabric/TurboModules)

### Supported Templates

GridTemplate, ListTemplate, TabBarTemplate, NowPlayingTemplate, InformationTemplate, MapTemplate, SearchTemplate, **VoiceControlTemplate**, AlertTemplate, ActionSheetTemplate, PointOfInterestTemplate, ContactTemplate, MessageTemplate

### Limitations

- Imperative API only (not declarative React) — this is a CarPlay SDK constraint
- Not all CPTemplate features implemented, lags behind native
- Need initial data before CarPlay launch (no black screen)
- Networking very limited in CarPlay context
- When Apple releases new AI voice templates (iOS 26.4), there will be a **lag** before the library supports them

### Forks

- `@g4rb4g3/react-native-carplay` (Expo SDK 53 compatible)
- `@spicysparks/react-native-carplay`
- `@gcores/react-native-carplay`

## Apple Watch + React Native: WATCH APP MUST BE NATIVE SWIFT

- **No React Native runtime on watchOS** — Watch UI must be Swift/SwiftUI
- Bridge data via `react-native-watch-connectivity` (messages, user info, file transfers)
- Architecture: Swift watchOS target in Xcode + RN phone app + WatchConnectivity bridge

## Siri Shortcuts + React Native: PARTIALLY

- **Basic shortcuts**: `react-native-siri-shortcut` (Gustash) — works for "Hey Siri, ask Claw"
- **App Intents (iOS 16+)**: Must be written in **native Swift** — no RN library exists
- App Intents needed for Apple Intelligence, Spotlight, advanced Shortcuts

## Voice/Audio Libraries

### Speech-to-Text

| Library | Type | Notes |
|---|---|---|
| `@react-native-voice/voice` | Online | Most popular, wraps iOS Speech framework |
| `react-native-executorch` | **On-device** | Whisper models (77MB), fully offline, streaming, VAD |
| `rn-whisper-stt` | On-device | TFLite Whisper, lighter alternative |
| Picovoice | On-device | Commercial SDK |

### Audio Playback / TTS

| Library | Notes |
|---|---|
| `react-native-track-player` | Gold standard. Background mode, lock screen, HLS |
| `react-native-tts` | Native iOS AVSpeechSynthesizer |
| `react-native-audio-pro` | High-performance, newer alternative |

### WebSocket

- React Native has **built-in WebSocket** (`new WebSocket(url)`)
- Works for real-time audio streaming (~40ms PCM chunks)

## Pros and Cons: React Native vs Native Swift

### Pros of React Native

1. **Android Auto for free** — `react-native-carplay` supports both platforms
2. **Faster development** — hot reload, TypeScript, large npm ecosystem
3. **Code sharing** — 70-80% business logic shared between iOS and Android
4. **Your expertise** — you're a React Native developer
5. **CarPlay templates work** — VoiceControlTemplate, NowPlaying, List, Grid all supported

### Cons of React Native

1. **Apple Watch must be native Swift regardless** — adds Swift code to the project
2. **App Intents must be native Swift** — for deep Siri integration
3. **CarPlay library lags behind Apple SDK** — new iOS 26.4 AI templates won't be immediately available
4. **~5ms bridge latency** — for real-time voice, though unlikely noticeable
5. **Community library dependency** — 781 stars is active but not huge
6. **No Expo managed workflow** — must use bare RN or Expo Dev Client
7. **Some template features missing** — not 100% parity with native CarPlay API

## Recommended Architecture: Hybrid

```
┌─────────────────────────────────────────────────────┐
│                React Native (TypeScript)              │
│                                                       │
│   Main Phone App          Shared Business Logic       │
│   - Chat UI               - WebSocket client          │
│   - Settings               - Gateway protocol          │
│   - Onboarding             - Audio pipeline            │
│   - History                - State management          │
└──────────────┬───────────────────────────────────────┘
               │ Native Modules (Swift)
┌──────────────┴───────────────────────────────────────┐
│                                                       │
│   CarPlay Module     Watch App        Siri Intents    │
│   (if react-native   (SwiftUI,       (App Intents    │
│    -carplay isn't     WatchKit)        framework)     │
│    sufficient)                                        │
└──────────────────────────────────────────────────────┘
```

**Start with react-native-carplay.** If it proves insufficient for the new iOS 26.4 AI templates, write a native Swift CarPlay module bridged to RN. The Watch app and App Intents will be native Swift regardless.

## Expo vs Bare React Native

| | Expo Managed | Expo Dev Client | Bare RN |
|---|---|---|---|
| CarPlay | No | Yes (with fork) | Yes |
| Apple Watch | No | Manual Xcode | Yes |
| Siri Shortcuts | Config plugin | Yes | Yes |
| EAS Build | Yes | Yes | Optional |

**Verdict**: Use **bare React Native** or **Expo Dev Client**. Expo Managed is not viable.
