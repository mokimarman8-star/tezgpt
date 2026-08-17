# ⚡ TezGPT

**Your private AI workspace — Bring Your Own Key, Agent Mode & Continuous Memory.**

TezGPT is a self-hosted AI chat platform. Use your own API keys (OpenAI, Anthropic, OpenRouter and more) — they stay **on your device**, never on a server. Chat casually, run coding agents, and come back anytime: TezGPT remembers where you left off.

---

## ✨ Features

- 🔑 **BYOK (Bring Your Own Key)** — Add your AI API key + GitHub token in Settings. Keys are encrypted (AES-GCM) and stored **only in your browser** (IndexedDB). They are never sent to or stored on any server.
- 🛡️ **Secret Paste Protection** — Accidentally paste a token/key into chat? TezGPT silently detects it, saves it into the correct Settings field, and clears the chat input. Nothing ever leaves your device.
- 🤖 **Agent Mode** — Sandboxed terminal, file editing, git operations (commit/push/PR using your saved GitHub token), self-test → fix → re-test loop until the task passes.
- 📈 **Live Building Panel** — Watch the agent work in real time: current step, progress, files being created.
- 🧠 **Continuous Memory** — Conversations, tasks and decisions persist across sessions (IndexedDB). Resume an agent task exactly where you left it.
- 💬 **Personality** — Warm, light-hearted in casual chat; focused and professional in coding/task mode.
- 📁 **File & Folder Upload** — Drag-and-drop with progress, previews and folder support.
- 📱 **Android App** — Capacitor-wrapped APK, auto-built via GitHub Actions.
- 🎨 **Your data, your rules** — Single-user BYOK mode runs without MongoDB (optional).

## 🚀 Quick Start

```bash
# 1. Install
npm install

# 2. Start (single-user BYOK mode)
npm run frontend:dev      # or: npm run backend:dev

# 3. Open the app, go to Settings → add your AI API key
```

## ⚙️ Configuration

| What | How |
|---|---|
| AI API Key | Settings → "AI API Key" (Anthropic / OpenAI / OpenRouter) |
| GitHub Token | Settings → "GitHub Token" (used by Agent Mode for commit/push/PR) |
| Backend DB | Optional in BYOK single-user mode; MongoDB only needed for multi-user sync |

## 📄 Privacy

Keys never leave your device. Full details: **[PRIVACY_POLICY.md](PRIVACY_POLICY.md)**

## ⚖️ License & Attribution

Licensed under the **MIT License** (see [LICENSE](LICENSE)).

This project is derived from [LibreChat](https://github.com/danny-avila/LibreChat) (MIT License, © LibreChat contributors) with rebranding and original features added.

---

*TezGPT — tez, powerful, aur aapka.* ⚡
