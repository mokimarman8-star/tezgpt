# TezGPT — Privacy Policy

**Last updated:** 17 August 2026

## 1. Overview

TezGPT is a privacy-first AI assistant app. This policy explains what data TezGPT does and does not collect, store, or transmit.

## 2. The core promise: your keys never reach a server

TezGPT works in **Bring-Your-Own-Key (BYOK)** mode by default:

- Your **AI API keys** (Anthropic, OpenAI, OpenRouter, etc.) and your **GitHub token** are entered by you in the app's Settings screen.
- These secrets are encrypted with **AES-GCM** (WebCrypto) using a key derived on your device, and stored **only in your browser's local storage (IndexedDB)**.
- They are **never uploaded to, stored by, or logged on any TezGPT server**, and never appear in analytics or error logs.
- If you paste a key/token into the chat by mistake, TezGPT silently detects it, moves it into the correct Settings field, and clears the chat input — the value is never sent to any AI or server.

**AI request routing:** Chat requests are sent directly from your device to the AI provider you configured (e.g., OpenRouter, Anthropic). No third-party TezGPT service sees or relays your messages or keys. (Note: some providers block direct browser calls — in those cases the app uses an OpenRouter-compatible gateway or, on Android, the native network layer; the key still never reaches a TezGPT server.)

## 3. Data stored locally (on your device)

- Chat conversations, messages, agent tasks, and memory summaries (IndexedDB).
- Your settings and preferences (localStorage).

All of this stays on your device unless you choose to use the optional self-hosted sync server.

## 4. Data we do NOT collect

- No advertising identifiers, no third-party ad SDKs.
- No account system in BYOK mode (no email, no phone number required).
- No keystroke logging; no hidden telemetry of your conversations.

## 5. Optional self-hosted server (multi-user mode)

TezGPT's server component is optional and self-hosted by you. If you run it, data (accounts, conversations) lives on **your own infrastructure**. TezGPT never operates it for you.

## 6. Android app permissions

| Permission | Why |
|---|---|
| INTERNET | To call the AI API endpoints you configured |
| Storage / file access | For file & folder upload feature |

No camera, contacts, SMS, microphone, or location permissions are requested.

## 7. Third-party services

When you use your own keys, the AI provider's own privacy policy applies to the requests you send them. TezGPT does not share data between providers.

## 8. Children's privacy

TezGPT is not directed to children under 13. We do not knowingly collect personal information from children.

## 9. Changes

We may update this policy; changes will be posted in the app and on the repository.

## 10. Contact

GitHub Issues: `https://github.com/tezgpt-ai/tezgpt/issues`
