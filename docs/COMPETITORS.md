# Competitor Analysis — OpenClaw iOS Apps

## Research Date: Feb 16, 2026

---

## 1. GoClaw — OpenClaw App

| Field | Details |
|---|---|
| **Developer** | Apphive Io |
| **Price** | Free + IAP |
| **IAP** | Trial $9.99, Basic $59.99, Advanced $89.99, Credit packs ($2.99–$39.99) |
| **Size** | 32.5 MB |
| **Rating** | 3.7/5 (9 ratings) |
| **Version** | 1.1 (released ~Feb 11, 2026) |
| **Compatibility** | iOS 13.0+, iPad, Mac (M1+), Vision Pro |
| **Website** | goclaw.io |

### What It Does
- **Managed hosting** — deploys OpenClaw instance for you (no VPS needed)
- Chat with your AI agent from the app
- Connect channels (WhatsApp, Telegram, Discord, Slack)
- Smart search, reminders/tasks, scheduled messaging
- Monitor usage and health in real-time

### Hosting Model
Cloud-hosted on Google Cloud. User doesn't touch servers. Sign up → create instance → connect chat app.

### Strengths
- Simplest onboarding ("under 3 minutes, no servers, no code")
- Managed infrastructure (user doesn't need VPS)
- Real product with real users (9 ratings)
- Product Hunt presence
- Broad device support (iOS 13+, Vision Pro)

### Weaknesses
- **Expensive IAP** — $59.99 Basic, $89.99 Advanced (one-time? unclear)
- **Credit-based pricing** — opaque cost model
- **3.7 rating** — "sometimes the bot misunderstands complex requests"
- **No voice/CarPlay** — pure text chat + channel management
- **No device node features** — no camera, location, etc.
- **Vendor lock-in** — your agent runs on their cloud, not your infrastructure
- **Generic AI wrapper feel** — could be any chatbot app

### Key User Feedback
> "search and reminders work really well but sometimes the bot misunderstands complex requests"

---

## 2. Clawly AI — OpenClaw Client

| Field | Details |
|---|---|
| **Developer** | Andrei Vychau (indie dev) |
| **Price** | Free + IAP |
| **IAP** | Premium: ~$5/mo or ~$35/yr (in KZT) |
| **Size** | 15.7 MB |
| **Rating** | No ratings yet |
| **Version** | Unknown (recent) |
| **Compatibility** | iOS 18.0+, iPad, Mac (M1+), Vision Pro |
| **Website** | clawly.org (managed hosting service) |

### What It Does
- "AI execution agent" — emphasis on doing things, not just chatting
- Trip planning (flights + hotels)
- Professional email/message drafting
- Multi-step task execution
- Structured outputs with links and formatting
- Full context awareness across conversations

### Hosting Model
Managed hosting via clawly.org:
- BYOK: $19/mo (1 agent, Telegram + Discord)
- Managed: $39/mo + usage (all channels, $25 API credits)
- Pro: $99/mo (5 agents, analytics, priority support)

### Strengths
- **Cheapest managed option** ($19/mo BYOK)
- **Action-oriented positioning** ("real actions, not just suggestions")
- Transparent pricing with budget alerts
- Agent config import/export (portability)
- Auto-updates with rollback
- Lightweight app (15.7 MB)

### Weaknesses
- **No ratings/reviews** — very new, unproven
- **iOS 18.0+ only** — excludes older devices
- **No voice/CarPlay** — text only
- **No device node features**
- **Managed hosting dependency** — not a self-hosted client
- **Privacy concern** — collects Device ID, User ID, Product Interaction data
- **Google Docs for legal docs** — unprofessional (privacy policy + ToS are Google Docs links)

---

## 3. OpenClow — AI Agent Tool

| Field | Details |
|---|---|
| **Developer** | Taiyuan Juli Caiyuan Network Technology Co., Ltd (Chinese company) |
| **Price** | Free + IAP |
| **IAP** | Weekly $0.73, Yearly $2.33, Lifetime $3.50 (in KZT, very cheap) |
| **Size** | 17.4 MB |
| **Rating** | 0 ratings |
| **Version** | 2.1 (Feb 8, 2026) |
| **Compatibility** | iOS 15.0+ |
| **Website** | None found |

### What It Does
- Generic AI chat ("AIClawd, your revolutionary AI-powered chat companion")
- Homework help, career advice, casual conversations
- Claims to adapt to communication style and remember interactions

### Strengths
- Very cheap ($3.50 lifetime)
- 47 languages supported
- Claims no data collection

### Weaknesses
- **Likely NOT a real OpenClaw client** — reads like a generic ChatGPT wrapper
- **No OpenClaw integration mentioned** — no gateway connection, no channels
- **Chinese developer** — trust/privacy concerns despite "no data collection" claim
- **Zero ratings** — nobody uses it
- **Misleading name** — "OpenClow" capitalizing on OpenClaw's name
- **Age rating 13+** (others are 4+) — suspicious
- **No voice, no CarPlay, no device features**

---

## Summary Comparison

| Feature | GoClaw | Clawly | OpenClow | Our App |
|---|---|---|---|---|
| **Real OpenClaw client** | Yes | Yes | Probably not | Yes |
| **Self-hosted support** | No (managed only) | No (managed only) | No | **Yes** |
| **Managed hosting** | Yes | Yes | No | Optional (later) |
| **Voice / TTS** | No | No | No | **Yes (core feature)** |
| **CarPlay** | No | No | No | **Yes (Phase 2)** |
| **Apple Watch** | No | No | No | **Yes (Phase 3)** |
| **Siri Shortcuts** | No | No | No | **Yes (MVP)** |
| **Device node** | No | No | No | **Yes (camera, location)** |
| **Connect to own VPS** | No | No | No | **Yes** |
| **Onboarding** | 3 min (managed) | 1-click (managed) | Generic signup | QR/URL scan |
| **Price** | $59-89 one-time | $19-99/mo | $3.50 lifetime | TBD |
| **Ratings** | 3.7 (9) | None | None | N/A |
| **App size** | 32.5 MB | 15.7 MB | 17.4 MB | Target <20 MB |

---

## Key Insights

### 1. Nobody has built a voice/CarPlay OpenClaw client
All three competitors are **text-only chat apps**. Voice is completely unaddressed. This is our primary differentiator.

### 2. All competitors are managed-hosting wrappers
GoClaw and Clawly sell hosting, not software. Their apps are frontends to their paid cloud service. Nobody serves the self-hosted user who already has OpenClaw running on their own VPS.

### 3. The market is tiny but real
GoClaw has 9 ratings, Clawly and OpenClow have zero. These are very early-stage products with minimal traction. The window is wide open.

### 4. Onboarding is the battleground
GoClaw's pitch is "3 minutes, no servers." For self-hosted users, we need an equally smooth onboarding — scan QR from your gateway terminal, or paste a Tailscale URL.

### 5. Pricing is all over the place
- GoClaw: $59-89 (expensive for what it is)
- Clawly: $19-99/mo (SaaS model)
- OpenClow: $3.50 (probably fake/worthless)
- Opportunity: fair pricing for a quality native client

### 6. Trust and quality are low
Google Docs as legal documents, Chinese shell companies, generic ChatGPT wrappers with OpenClaw branding — the bar is LOW. A polished, trustworthy, open-source app would stand out immediately.

---

## Our Competitive Advantages (Planned)

1. **Voice-first** — nobody else does this
2. **CarPlay** — completely unaddressed market
3. **Apple Watch** — nobody else does this
4. **Siri Shortcuts** — "Hey Siri, ask Claw" — works today
5. **Self-hosted first** — connect to YOUR gateway, not our cloud
6. **Device node** — camera, location, notifications exposed to agent
7. **Open source** — builds trust with OpenClaw community
8. **Native Swift/SwiftUI** — fast, light, Apple-native feel
9. **No vendor lock-in** — your agent, your data, your VPS
