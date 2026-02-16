# Claw Drive — OpenClaw Mobile Companion with CarPlay & Apple Watch

## Vision

The first dedicated mobile companion app for OpenClaw — giving 145K+ users a native iOS experience with CarPlay voice mode, Apple Watch quick-access, and Siri Shortcuts integration. Talk to your AI agent hands-free while driving, from your wrist, or with a simple "Hey Siri, ask Claw..."

---

## Why Now

- **Apple announced (Feb 2026)** third-party AI voice assistants coming to CarPlay in iOS 26.4
- **OpenClaw has 145K+ GitHub stars** — massive growing userbase
- **Official iOS app is alpha** — buggy, foreground-only, no CarPlay, not on App Store
- **No competitor** has built a CarPlay client for OpenClaw yet
- **First-mover window**: a few months before iOS 26.4 drops

---

## Target Users

- OpenClaw power users who want mobile access to their agent
- Professionals who spend time driving and want hands-free AI
- Anyone frustrated with the broken official iOS alpha app

---

## Product Features

### Phase 1: MVP (Core Mobile App)

| Feature | Description |
|---|---|
| **Gateway connection** | WebSocket connection to OpenClaw Gateway (local, Tailscale, or public via Funnel) |
| **Push-to-talk** | Tap to speak, agent responds with voice |
| **Text chat** | Standard chat interface with the agent |
| **Voice output** | ElevenLabs TTS or system TTS for agent responses |
| **STT** | Whisper/Deepgram/Apple Speech for voice input |
| **Session management** | View active sessions, switch between them |
| **Pairing flow** | QR code or manual gateway URL + token entry |
| **Siri Shortcut** | "Hey Siri, ask Claw..." — bridges Siri to OpenClaw (works TODAY, no CarPlay needed) |

### Phase 2: CarPlay

| Feature | Description |
|---|---|
| **CarPlay voice mode** | Tap app icon on CarPlay → voice mode auto-activates |
| **Voice conversation** | Natural back-and-forth with the agent while driving |
| **Minimal CarPlay UI** | Template-based (Apple requirement): conversation history + status |
| **Audio ducking** | Properly mix with car audio (music pauses during agent speech) |
| **Safety-first UX** | No complex interactions — voice only while driving |

### Phase 3: Apple Watch + Device Node

| Feature | Description |
|---|---|
| **Watch app** | Tap to talk from your wrist |
| **Watch complication** | Quick-launch on watch face |
| **Device node capabilities** | Expose phone sensors to OpenClaw: camera, location, notifications |
| **Push notifications** | Agent can send you push alerts |
| **Background mode** | Maintain gateway connection for incoming agent messages |

### Phase 4: Premium Features

| Feature | Description |
|---|---|
| **Voice selection** | Choose ElevenLabs voice for your agent |
| **Conversation history** | Browse past voice conversations |
| **Multiple gateways** | Connect to work + personal OpenClaw instances |
| **Widgets** | Home screen widgets for quick actions |
| **Live Activities** | Show agent status on lock screen during long tasks |

---

## Architecture

```
┌──────────────────────────────────────────────────┐
│                    iOS App                        │
│                                                   │
│  ┌─────────┐  ┌──────────┐  ┌─────────────────┐ │
│  │ CarPlay  │  │  Watch   │  │   Main App      │ │
│  │  Voice   │  │  Comms   │  │  Chat + Voice   │ │
│  └────┬─────┘  └────┬─────┘  └───────┬─────────┘ │
│       │              │                │            │
│       └──────────────┴────────────────┘            │
│                      │                             │
│           ┌──────────┴──────────┐                  │
│           │  Gateway Client     │                  │
│           │  (WebSocket)        │                  │
│           └──────────┬──────────┘                  │
│                      │                             │
│           ┌──────────┴──────────┐                  │
│           │  Voice Engine       │                  │
│           │  STT: Apple/Whisper │                  │
│           │  TTS: ElevenLabs    │                  │
│           └─────────────────────┘                  │
└──────────────────────────────────────────────────┘
                       │
                 WebSocket / HTTPS
                       │
┌──────────────────────┴───────────────────────────┐
│              OpenClaw Gateway (VPS)               │
│         ws://gateway:18789 or Tailscale           │
│                                                    │
│  LLM + Tools + Memory + Skills + Channels         │
└──────────────────────────────────────────────────┘
```

---

## Tech Stack

| Layer | Technology |
|---|---|
| **iOS App** | Swift / SwiftUI |
| **CarPlay** | CarPlay Framework (CPVoiceControlTemplate, CPListTemplate) |
| **Apple Watch** | WatchKit / SwiftUI |
| **Networking** | URLSessionWebSocketTask or Starscream (WebSocket) |
| **Voice Input (STT)** | Apple Speech framework (free, on-device) → fallback to Whisper API |
| **Voice Output (TTS)** | ElevenLabs SDK (premium) / AVSpeechSynthesizer (free fallback) |
| **Siri Integration** | SiriKit + App Intents framework |
| **Storage** | SwiftData / Core Data for conversation history |
| **Auth** | Keychain for gateway tokens |

---

## Siri Shortcut Workaround (Works Today)

No CarPlay entitlement needed. Users set up a Siri Shortcut:

1. User says: **"Hey Siri, ask Claw"**
2. Siri Shortcut opens the app with voice mode active
3. App captures speech → sends to OpenClaw Gateway
4. Agent response plays back via TTS

Implementation: `App Intents` framework with `AppShortcutProvider`

```swift
struct AskClawIntent: AppIntent {
    static var title: LocalizedStringResource = "Ask Claw"
    static var openAppWhenRun: Bool = true

    @Parameter(title: "Question")
    var question: String?

    func perform() async throws -> some IntentResult {
        // Open app in voice mode, optionally with pre-filled question
    }
}
```

---

## Apple Requirements

| Requirement | Details |
|---|---|
| **Developer Account** | $99/yr |
| **CarPlay Entitlement** | Must apply via Apple developer portal — approval not guaranteed |
| **App Review** | Strict for CarPlay (safety-focused), standard for main app |
| **Privacy** | Must declare mic, location, camera usage |
| **Minimum iOS** | iOS 17+ (for App Intents), CarPlay features require iOS 26.4+ |

---

## Revenue Model Options

| Model | Price | Notes |
|---|---|---|
| **Freemium** | Free app + $4.99/mo premium | Free: text chat + basic voice. Premium: CarPlay, Watch, ElevenLabs voices |
| **One-time purchase** | $9.99 | Simple, no recurring revenue |
| **Subscription** | $5.99/mo or $49.99/yr | Full access to all features |
| **Open source + donations** | Free | Build reputation in OpenClaw community, monetize via consulting/customization |

---

## Competitive Landscape

| Player | Status | Weakness |
|---|---|---|
| **Official OpenClaw iOS** | Alpha, not on App Store | Buggy, no CarPlay, foreground-only |
| **ChatGPT iOS** | Mature app | Not connected to OpenClaw, no self-hosted agent |
| **Gemini iOS** | Google's app | Same — not OpenClaw compatible |
| **Custom Siri + Shortcuts** | Hacky workarounds | No dedicated UX, limited functionality |
| **Claw Drive (us)** | First dedicated OpenClaw mobile companion | First-mover advantage |

---

## Risks

| Risk | Severity | Mitigation |
|---|---|---|
| CarPlay entitlement rejected | High | Start with Siri Shortcuts (no entitlement needed), apply early |
| OpenClaw improves their iOS app | Medium | Move faster, contribute upstream, differentiate with CarPlay/Watch |
| Apple blocks the category | Low | App Intents + Siri Shortcuts work regardless |
| Small market (only OpenClaw users) | Medium | 145K stars and growing fast; also useful as generic AI voice client |
| Gateway protocol changes | Medium | Track OpenClaw releases, contribute to protocol stability |

---

## Open Questions (To Resolve Before Building)

1. **Gateway protocol**: What exactly is the WebSocket API? Need to study OpenClaw's gateway protocol docs/source
2. **Auth flow**: How does the official iOS app authenticate with the gateway? Token? QR?
3. **CarPlay entitlement**: What category to apply under? Communication? Navigation?
4. **Voice pipeline**: Server-side TTS (via OpenClaw + ElevenLabs) vs client-side TTS (ElevenLabs SDK in app)?
5. **Naming**: "Claw Drive"? "ClawMobile"? "PocketClaw"? Check trademarks
6. **Licensing**: If we use OpenClaw's gateway protocol, are there licensing implications? (MIT = should be fine)
7. **Official relationship**: Should we reach out to OpenClaw maintainers? Could become an official community app
8. **Android**: Build iOS-first, but is Android on the roadmap? (Android Auto equivalent)
9. **Monetization**: What does the OpenClaw community prefer — paid app, freemium, or open source?
10. **MVP scope**: Ship Siri Shortcut + push-to-talk first (2 weeks), or wait for CarPlay (2-3 months)?

---

## Suggested Next Steps

1. **Research OpenClaw Gateway protocol** — read source code at `github.com/openclaw/openclaw`, understand WebSocket API
2. **Study the official iOS app** — `apps/ios` in the repo, understand what exists and what's missing
3. **Apply for CarPlay entitlement** — do this early, Apple approval takes weeks
4. **Build MVP** — Siri Shortcut + push-to-talk voice app (no CarPlay needed)
5. **Beta test with OpenClaw community** — post on GitHub Discussions / Discord
6. **Add CarPlay** when iOS 26.4 drops and entitlement is approved
7. **Add Apple Watch** as Phase 3
