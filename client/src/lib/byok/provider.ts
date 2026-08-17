/**
 * TezGPT BYOK — Direct provider client
 *
 * Sends chat requests DIRECTLY from the browser to the provider whose key
 * the user configured. No TezGPT server ever sees the key or the request.
 *
 * CORS notes (documented honestly in PRIVACY_POLICY.md):
 *  - OpenRouter: browser-direct calls allowed (CORS OK)
 *  - Anthropic:  allowed with the `anthropic-dangerous-direct-browser-access` header
 *  - Google:     allowed via the generativeLanguage API with ?key=
 *  - OpenAI:     does NOT allow browser-direct calls (CORS). The app will
 *                surface a clear error suggesting the OpenRouter gateway or
 *                the Android build (CapacitorHttp is not subject to browser CORS).
 */

import { detectProviderFromKey, type SecretProvider } from './detector';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface StreamOptions {
  provider: SecretProvider;
  apiKey: string;
  model: string;
  messages: ChatMessage[];
  temperature?: number;
  maxTokens?: number;
  signal?: AbortSignal;
  onDelta?: (text: string) => void;
  onDone?: (fullText: string) => void;
  onError?: (error: Error) => void;
}

const DEFAULT_MODELS: Record<SecretProvider, string> = {
  anthropic: 'claude-sonnet-4-6',
  openai: 'gpt-4o-mini',
  openrouter: 'openai/gpt-4o-mini',
  google: 'gemini-2.0-flash',
  stability: 'stable-diffusion-xl',
  'openai-compatible': 'gpt-4o-mini',
};

/** Resolve provider from a raw key (caller can also pass it explicitly). */
export function providerForKey(key: string): SecretProvider {
  return detectProviderFromKey(key);
}

/** Build the system prompt used for BYOK sessions (personality per spec). */
export function buildSystemPrompt(): string {
  return [
    'You are TezGPT — a powerful, warm AI assistant.',
    'In casual conversation: be light-hearted, warm, and a little playful. Use gentle humor where it fits. Celebrate when a task is completed, and be supportive and comforting if the user seems sad or tired. Sound natural and human — not robotic.',
    'In coding, agent, or task mode: be focused, precise, and professional. No fluff; give working solutions and test them.',
    'The user may communicate in Hinglish (Hindi written in Latin script). Reply in the language the user uses.',
  ].join('\n');
}

async function* parseSseStream(res: Response): AsyncGenerator<string> {
  const reader = res.body?.getReader();
  if (!reader) {
    return;
  }
  const decoder = new TextDecoder();
  let buffer = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith('data:')) {
        continue;
      }
      const data = trimmed.slice(5).trim();
      if (data === '[DONE]') {
        return;
      }
      try {
        const parsed = JSON.parse(data);
        const delta = parsed?.choices?.[0]?.delta?.content ?? parsed?.choices?.[0]?.text ?? '';
        if (delta) {
          yield delta;
        }
      } catch {
        /* partial chunk — ignore */
      }
    }
  }
}

async function* parseJsonLines(res: Response): AsyncGenerator<string> {
  const reader = res.body?.getReader();
  if (!reader) {
    return;
  }
  const decoder = new TextDecoder();
  let buffer = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) {
        continue;
      }
      try {
        const parsed = JSON.parse(trimmed);
        const type = parsed?.type;
        if (type === 'content_block_delta' && parsed?.delta?.text) {
          yield parsed.delta.text;
        }
        if (type === 'message_stop') {
          return;
        }
      } catch {
        /* ignore */
      }
    }
  }
}

async function* parseGoogleStream(res: Response): AsyncGenerator<string> {
  const text = await res.text();
  const parts = text.split(',');
  let buffer = '';
  for (const part of parts) {
    buffer += part;
    try {
      const parsed = JSON.parse(buffer);
      buffer = '';
      const candidates = parsed?.candidates ?? [];
      for (const c of candidates) {
        const chunk = c?.content?.parts?.[0]?.text ?? '';
        if (chunk) {
          yield chunk;
        }
      }
    } catch {
      /* partial json — accumulate */
    }
  }
}

/** Stream a chat completion directly to the provider. */
export async function streamChat(opts: StreamOptions): Promise<string> {
  const { provider, apiKey, messages, onDelta, onDone, onError, signal } = opts;
  const model = opts.model || DEFAULT_MODELS[provider];
  let full = '';

  try {
    if (provider === 'anthropic') {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        signal,
        headers: {
          'content-type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          'anthropic-dangerous-direct-browser-access': 'true',
        },
        body: JSON.stringify({
          model,
          max_tokens: opts.maxTokens ?? 4096,
          temperature: opts.temperature ?? 0.7,
          system: messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n'),
          messages: messages.filter((m) => m.role !== 'system'),
          stream: true,
        }),
      });
      if (!res.ok) {
        throw new Error(`Anthropic ${res.status}: ${await res.text()}`);
      }
      for await (const delta of parseJsonLines(res)) {
        full += delta;
        onDelta?.(delta);
      }
    } else if (provider === 'google') {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:streamGenerateContent?alt=sse&key=${encodeURIComponent(apiKey)}`,
        {
          method: 'POST',
          signal,
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            contents: messages
              .filter((m) => m.role !== 'system')
              .map((m) => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] })),
            systemInstruction: {
              parts: [{ text: messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n') }],
            },
          }),
        },
      );
      if (!res.ok) {
        throw new Error(`Google ${res.status}: ${await res.text()}`);
      }
      const raw = await res.text();
      // SSE-lines of json data:
      for (const line of raw.split('\n')) {
        const t = line.trim();
        if (!t.startsWith('data:')) {
          continue;
        }
        try {
          const parsed = JSON.parse(t.slice(5).trim());
          const chunk = parsed?.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
          if (chunk) {
            full += chunk;
            onDelta?.(chunk);
          }
        } catch {
          /* ignore */
        }
      }
    } else if (provider === 'openrouter') {
      const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        signal,
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${apiKey}`,
          'HTTP-Referer': typeof location !== 'undefined' ? location.origin : 'https://tezgpt.app',
          'X-Title': 'TezGPT',
        },
        body: JSON.stringify({
          model,
          stream: true,
          temperature: opts.temperature ?? 0.7,
          max_tokens: opts.maxTokens ?? 4096,
          messages,
        }),
      });
      if (!res.ok) {
        throw new Error(`OpenRouter ${res.status}: ${await res.text()}`);
      }
      for await (const delta of parseSseStream(res)) {
        full += delta;
        onDelta?.(delta);
      }
    } else {
      // openai / openai-compatible — direct browser calls are CORS-blocked by OpenAI.
      // We still try (works behind proxies / in Capacitor native builds).
      const base =
        provider === 'openai' ? 'https://api.openai.com/v1' : localStorage.getItem('tezgpt-compatible-base') ?? '';
      if (!base && provider === 'openai-compatible') {
        throw new Error('Custom base URL not configured.');
      }
      const res = await fetch(`${base}/chat/completions`, {
        method: 'POST',
        signal,
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          stream: true,
          temperature: opts.temperature ?? 0.7,
          max_tokens: opts.maxTokens ?? 4096,
          messages,
        }),
      });
      if (!res.ok) {
        throw new Error(`OpenAI-compatible ${res.status}: ${await res.text()}`);
      }
      for await (const delta of parseSseStream(res)) {
        full += delta;
        onDelta?.(delta);
      }
    }
    onDone?.(full);
    return full;
  } catch (err) {
    const e = err instanceof Error ? err : new Error(String(err));
    if (e.name === 'TypeError' && provider === 'openai') {
      const hint = new Error(
        'OpenAI blocks direct browser calls (CORS). Use an OpenRouter key (openrouter.ai) or the TezGPT Android app instead.',
      );
      onError?.(hint);
      throw hint;
    }
    onError?.(e);
    throw e;
  }
}
