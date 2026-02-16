# iClawd

Voice-first mobile companion for [OpenClaw](https://github.com/openclaw/openclaw) — talk to your self-hosted AI agents hands-free from your phone.

## Features

- **Push-to-talk & continuous listening** — tap to speak or let the app listen continuously with automatic silence detection
- **Text chat** — full chat interface with streaming responses
- **ElevenLabs TTS** — natural-sounding voice responses (with system voice fallback)
- **Siri Shortcuts** — say "Hey Siri, Ask Claw" to jump straight into voice mode
- **Secure by design** — Ed25519 device authentication, credentials stored in iOS Keychain / Android Keystore
- **Self-hosted** — connects to YOUR OpenClaw gateway, no third-party cloud, no vendor lock-in
- **Open source** — MIT licensed

## How It Works

```
┌─────────────────────────┐
│        iClawd App       │
│                         │
│  Voice ←→ VoiceEngine   │
│  Chat  ←→ GatewayClient │
└────────────┬────────────┘
             │ WebSocket
┌────────────┴────────────┐
│    OpenClaw Gateway     │
│   (your server / VPS)   │
└─────────────────────────┘
```

The app connects to your OpenClaw gateway over WebSocket using the v3 protocol with challenge-response device authentication. Voice input is processed on-device via Apple Speech (iOS) and sent as text to your agent. Responses stream back in real-time and are spoken aloud via ElevenLabs or the system voice.

## Prerequisites

- [OpenClaw](https://github.com/openclaw/openclaw) instance with gateway enabled
- Gateway URL and authentication token
- Node.js 18+ and npm
- [Expo CLI](https://docs.expo.dev/get-started/installation/) (`npm install -g expo-cli`)
- For iOS: Xcode 16+ and an Apple Developer account
- For Android: Android Studio with SDK 34+

## Getting Started

```bash
# Clone the repo
git clone https://github.com/rvssvl/iclawd.git
cd iclawd

# Install dependencies
npm install

# Start the dev server
npx expo start
```

### Building for Device

```bash
# iOS simulator
npx expo run:ios

# Android emulator
npx expo run:android
```

### EAS Build (Production)

Copy the example EAS config and fill in your credentials:

```bash
cp eas.json.example eas.json
# Edit eas.json with your Apple Team ID, Apple ID, etc.
```

Then build:

```bash
npx eas build --platform ios --profile production
npx eas build --platform android --profile production
```

## Project Structure

```
app/
  _layout.tsx          Root navigator & OTA updates
  index.tsx            Onboarding screen
  connect.tsx          Gateway URL + token entry
  voice.tsx            Voice chat (primary interface)
  chat.tsx             Text chat
  settings.tsx         App settings

src/
  services/
    GatewayClient.ts   OpenClaw Gateway v3 WebSocket protocol
    VoiceEngine.ts     STT + TTS orchestration
    SiriService.ts     Siri Shortcuts integration
    SecureStorage.ts   Keychain wrapper

  contexts/
    GatewayContext.tsx  Global connection & message state

  components/
    VoiceOrb.tsx       Animated voice input orb
    ChatBubble.tsx     Chat message bubble
    ui/                Reusable UI primitives

  hooks/
    useVoice.ts        Voice engine React hook
    useGateway.ts      Gateway connection hook

  types/
    gateway.ts         OpenClaw protocol TypeScript types

  constants/
    theme.ts           Colors, spacing, animations
```

## Configuration

**Gateway connection** is configured in-app (Settings or first-launch flow). Enter your OpenClaw gateway URL and auth token.

**ElevenLabs TTS** (optional) can be enabled in Settings by providing your API key. Without it, the app uses the built-in system voice.

**Siri Shortcuts** can be added from Settings to enable "Hey Siri, Ask Claw".

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Framework | React Native (Expo 54) + React 19 |
| Language | TypeScript 5.9 |
| Navigation | Expo Router |
| Voice Input | @react-native-voice/voice (Apple Speech) |
| Voice Output | ElevenLabs API / expo-speech (fallback) |
| Animation | React Native Reanimated |
| Networking | WebSocket (OpenClaw Gateway v3 protocol) |
| Auth | Ed25519 signing (tweetnacl) |
| Storage | Expo Secure Store (Keychain / Keystore) |

## Roadmap

- [x] Gateway connection with device authentication
- [x] Push-to-talk voice chat
- [x] Continuous listening with silence detection
- [x] Text chat with streaming
- [x] ElevenLabs TTS + system fallback
- [x] Siri Shortcuts
- [x] OTA updates & push notifications
- [ ] QR code gateway pairing
- [ ] Multiple gateway support
- [ ] Conversation history
- [ ] CarPlay voice mode
- [ ] Apple Watch app
- [ ] App Intents for deeper Siri integration

## Privacy

iClawd does not collect, store, or transmit any personal data. There are no analytics, tracking, or telemetry SDKs. The app connects only to the gateway URL you configure. See [Privacy Policy](https://rvssvl.github.io/iclawd/#privacy-policy) for details.

## Contributing

Contributions are welcome! Please open an issue first to discuss what you'd like to change.

```bash
# Development build
npx expo start --dev-client

# Run on iOS simulator
npx expo run:ios
```

## License

[MIT](LICENSE) - Rassul Rakhimzhan
