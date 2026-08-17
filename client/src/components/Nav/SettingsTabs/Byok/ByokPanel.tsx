/**
 * TezGPT BYOK — Settings panel
 * AI API Key (Anthropic/OpenAI/OpenRouter/Google) + GitHub Token + Image Key.
 * All values are encrypted and stored ONLY in this browser (IndexedDB vault).
 * Nothing is ever sent to a server.
 */

import { useCallback, useEffect, useState } from 'react';
import { Eye, EyeOff, Trash2, ShieldCheck, KeyRound, GitBranch } from 'lucide-react';
import {
  saveSecret,
  getSecret,
  getSecretMeta,
  deleteSecret,
  type SecretMeta,
} from '~/lib/byok/vault';
import { detectProviderFromKey } from '~/lib/byok/detector';

interface FieldState {
  value: string;
  show: boolean;
  meta: SecretMeta | null;
  saved: boolean;
}

const EMPTY: FieldState = { value: '', show: false, meta: null, saved: false };

const KIND_LABELS: Record<string, string> = {
  aiKey: 'AI API Key',
  githubToken: 'GitHub Token',
  imageKey: 'Image-gen Key',
};

const PROVIDER_HINTS: Record<string, string> = {
  anthropic: 'Anthropic detected (sk-ant-…) — Claude models',
  openai: 'OpenAI detected (sk-…)',
  openrouter: 'OpenRouter detected (sk-or-…) — works from browser directly',
  google: 'Google AI detected (AIza…) — Gemini models',
  'openai-compatible': 'Custom / OpenAI-compatible key',
};

export default function ByokPanel() {
  const [aiKey, setAiKey] = useState<FieldState>(EMPTY);
  const [ghToken, setGhToken] = useState<FieldState>(EMPTY);
  const [imageKey, setImageKey] = useState<FieldState>(EMPTY);
  const [busy, setBusy] = useState(false);

  const loadAll = useCallback(async () => {
    try {
      const [aiMeta, ghMeta, imMeta, aiVal, ghVal, imVal] = await Promise.all([
        getSecretMeta('aiKey'),
        getSecretMeta('githubToken'),
        getSecretMeta('imageKey'),
        getSecret('aiKey'),
        getSecret('githubToken'),
        getSecret('imageKey'),
      ]);
      setAiKey({ value: aiVal ?? '', show: false, meta: aiMeta, saved: aiVal != null });
      setGhToken({ value: ghVal ?? '', show: false, meta: ghMeta, saved: ghVal != null });
      setImageKey({ value: imVal ?? '', show: false, meta: imMeta, saved: imVal != null });
    } catch {
      /* IndexedDB unavailable — fields stay empty */
    }
  }, []);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  const save = async (kind: 'aiKey' | 'githubToken' | 'imageKey', state: FieldState) => {
    if (!state.value.trim()) {
      return;
    }
    setBusy(true);
    try {
      const provider = kind === 'aiKey' ? detectProviderFromKey(state.value) : undefined;
      await saveSecret(kind, state.value.trim(), provider);
      await loadAll();
    } finally {
      setBusy(false);
    }
  };

  const remove = async (kind: 'aiKey' | 'githubToken' | 'imageKey') => {
    setBusy(true);
    try {
      await deleteSecret(kind);
      await loadAll();
    } finally {
      setBusy(false);
    }
  };

  const providerHint = aiKey.value
    ? PROVIDER_HINTS[detectProviderFromKey(aiKey.value)] ?? PROVIDER_HINTS['openai-compatible']
    : null;

  const renderField = (
    kind: 'aiKey' | 'githubToken' | 'imageKey',
    state: FieldState,
    setState: React.Dispatch<React.SetStateAction<FieldState>>,
    placeholder: string,
    hint: string,
    icon: React.ReactNode,
  ) => (
    <div className="space-y-2 rounded-xl border border-border-light bg-surface-secondary p-4">
      <div className="flex items-center justify-between gap-2">
        <label className="flex items-center gap-2 text-sm font-semibold text-text-primary">
          {icon}
          {KIND_LABELS[kind]}
        </label>
        {state.saved && (
          <span className="inline-flex items-center gap-1 rounded-full bg-green-500/15 px-2 py-0.5 text-xs font-medium text-green-600 dark:text-green-400">
            <ShieldCheck size={12} /> saved locally
          </span>
        )}
      </div>
      {state.saved && state.meta && (
        <div className="text-xs text-text-secondary">
          Stored: <code className="rounded bg-black/5 px-1 py-0.5 dark:bg-white/10">{state.meta.masked}</code>
          {state.meta.provider ? ` · ${state.meta.provider}` : ''}
        </div>
      )}
      <div className="flex gap-2">
        <input
          type={state.show ? 'text' : 'password'}
          value={state.value}
          onChange={(e) => setState((s) => ({ ...s, value: e.target.value }))}
          placeholder={placeholder}
          autoComplete="off"
          spellCheck={false}
          className="w-full rounded-lg border border-border-medium bg-surface-primary px-3 py-2 font-mono text-sm text-text-primary outline-none focus:border-accent-primary"
        />
        <button
          type="button"
          aria-label="toggle visibility"
          onClick={() => setState((s) => ({ ...s, show: !s.show }))}
          className="rounded-lg border border-border-medium px-3 text-text-secondary hover:bg-surface-hover"
        >
          {state.show ? <EyeOff size={16} /> : <Eye size={16} />}
        </button>
        <button
          type="button"
          disabled={busy || !state.value.trim()}
          onClick={() => save(kind, state)}
          className="rounded-lg bg-accent-primary px-4 text-sm font-semibold text-white hover:bg-accent-primary-hover disabled:opacity-40"
        >
          Save
        </button>
        {state.saved && (
          <button
            type="button"
            aria-label="remove"
            onClick={() => remove(kind)}
            className="rounded-lg border border-border-medium px-3 text-text-secondary hover:bg-surface-hover"
          >
            <Trash2 size={16} />
          </button>
        )}
      </div>
      <p className="text-xs text-text-tertiary">{hint}</p>
      {kind === 'aiKey' && providerHint && (
        <p className="text-xs font-medium text-accent-primary">{providerHint}</p>
      )}
    </div>
  );

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-accent-primary/30 bg-accent-primary/5 p-4 text-sm text-text-primary">
        <p className="font-semibold">🔐 100% local — keys never reach a server</p>
        <p className="mt-1 text-text-secondary">
          Keys are AES-GCM encrypted and stored only in this browser (IndexedDB). They are used directly
          for API calls from your device. Paste a key into the chat by mistake? It is silently moved here.
        </p>
      </div>

      {renderField(
        'aiKey',
        aiKey,
        setAiKey,
        'sk-ant-… / sk-… / sk-or-… / AIza…',
        'Anthropic, OpenAI, OpenRouter or Google key. Provider is auto-detected from the prefix. (Tip: OpenRouter keys work directly from the browser.)',
        <KeyRound size={16} className="text-accent-primary" />,
      )}

      {renderField(
        'githubToken',
        ghToken,
        setGhToken,
        'ghp_… / github_pat_…',
        'Used by Agent Mode for git operations — commit, push, pull requests. Requested only when the agent needs it; never asked twice.',
        <GitBranch size={16} className="text-accent-primary" />,
      )}

      {renderField(
        'imageKey',
        imageKey,
        setImageKey,
        'sk-… (image provider)',
        'Optional. Used by the agent for image-generation tasks. If missing, those tasks are marked "pending: needs image key" — everything else continues.',
        <KeyRound size={16} className="text-accent-primary" />,
      )}
    </div>
  );
}
