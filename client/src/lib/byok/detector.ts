/**
 * TezGPT BYOK — Secret Detector
 * Detects API keys / tokens typed or pasted into the chat input,
 * so they can be silently redirected into Settings instead of being
 * sent to any AI provider, server, or log.
 *
 * SECURITY: This module runs before ANY network request. Detected
 * values are only passed to the local vault (IndexedDB).
 */

export type SecretKind = 'aiKey' | 'githubToken' | 'imageKey';

export type SecretProvider =
  | 'anthropic'
  | 'openai'
  | 'openrouter'
  | 'google'
  | 'stability'
  | 'openai-compatible';

export interface DetectedSecret {
  kind: SecretKind;
  provider?: SecretProvider;
  /** the full matched secret value */
  value: string;
  /** match offsets within the scanned text */
  start: number;
  end: number;
}

interface PatternDef {
  kind: SecretKind;
  provider?: SecretProvider;
  re: RegExp;
}

const PATTERNS: PatternDef[] = [
  // ---- GitHub tokens (checked first; also matched by nothing else) ----
  { kind: 'githubToken', re: /\bgithub_pat_[A-Za-z0-9_]{20,}\b/g },
  { kind: 'githubToken', re: /\bghp_[A-Za-z0-9]{30,}\b/g },
  { kind: 'githubToken', re: /\bgho_[A-Za-z0-9]{30,}\b/g },
  { kind: 'githubToken', re: /\bghu_[A-Za-z0-9]{30,}\b/g },
  { kind: 'githubToken', re: /\bghs_[A-Za-z0-9]{30,}\b/g },
  { kind: 'githubToken', re: /\bghr_[A-Za-z0-9]{30,}\b/g },
  // ---- AI provider keys ----
  { kind: 'aiKey', provider: 'anthropic', re: /\bsk-ant-[A-Za-z0-9_-]{20,}\b/g },
  { kind: 'aiKey', provider: 'openrouter', re: /\bsk-or-[A-Za-z0-9_-]{20,}\b/g },
  { kind: 'aiKey', provider: 'openai', re: /\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}\b/g },
  { kind: 'aiKey', provider: 'google', re: /\bAIza[0-9A-Za-z_-]{30,}\b/g },
  { kind: 'imageKey', provider: 'stability', re: /\bsk-[A-Za-z0-9]{24}\b/g },
];

/**
 * Scan text for secret-like values.
 */
export function detectSecrets(text: string): DetectedSecret[] {
  if (!text || text.length < 16) {
    return [];
  }
  const found: DetectedSecret[] = [];
  for (const { kind, provider, re } of PATTERNS) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      const value = m[0].trim();
      // stability sk- 24-char pattern overlaps openai pattern; treat short sk- as imageKey only
      found.push({ kind, provider, value, start: m.index, end: m.index + value.length });
    }
  }
  // dedupe exact same value+kind
  const seen = new Set<string>();
  return found.filter((f) => {
    const k = `${f.kind}:${f.value}`;
    if (seen.has(k)) {
      return false;
    }
    seen.add(k);
    return true;
  });
}

/** Remove all detected secrets from text (used as a final safety net). */
export function stripSecrets(text: string): string {
  const secrets = detectSecrets(text);
  if (!secrets.length) {
    return text;
  }
  const sorted = [...secrets].sort((a, b) => b.start - a.start);
  let out = text;
  for (const s of sorted) {
    out = out.slice(0, s.start) + '[secret-redacted]' + out.slice(s.end);
  }
  return out;
}

/** Pick the single "best" secret (first in priority order) — used by the guard. */
export function pickPrimarySecret(secrets: DetectedSecret[]): DetectedSecret | null {
  return secrets[0] ?? null;
}

/** Guess a provider from a key prefix (for direct chat routing). */
export function detectProviderFromKey(key: string): SecretProvider {
  const k = key.trim();
  if (k.startsWith('sk-ant-')) {
    return 'anthropic';
  }
  if (k.startsWith('sk-or-')) {
    return 'openrouter';
  }
  if (k.startsWith('AIza')) {
    return 'google';
  }
  if (k.startsWith('sk-')) {
    return 'openai';
  }
  return 'openai-compatible';
}
