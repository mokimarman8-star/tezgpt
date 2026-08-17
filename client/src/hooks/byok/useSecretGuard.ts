/**
 * TezGPT — Secret Paste Guard
 *
 * Watches chat input. If the user types/pastes something that looks like a
 * GitHub token or an AI API key, the value is:
 *   1. NOT sent to the AI / server / logs (blocked before submit)
 *   2. silently encrypted + saved into the correct Settings field
 *   3. cleared from the chat input
 *   4. acknowledged with a tiny subtle indicator (no popups)
 */

import { useCallback, useRef } from 'react';
import { detectSecrets, type DetectedSecret } from '~/lib/byok/detector';
import { saveDetectedSecret } from '~/lib/byok/vault';
import { flashSecretSaved } from '~/lib/byok/indicator';

const KIND_LABEL: Record<string, string> = {
  aiKey: 'AI API Key',
  githubToken: 'GitHub Token',
  imageKey: 'Image-gen Key',
};

export interface GuardResult {
  /** true when secrets were found & handled (caller must abort sending) */
  blocked: boolean;
  /** the cleaned text (secrets removed) — safe to continue with if caller wishes */
  cleanText: string;
}

export function useSecretGuard() {
  const processing = useRef(false);

  /**
   * Scan text. If secrets found: save them locally, flash indicator,
   * and return blocked=true with cleaned text.
   * NEVER throws — the guard must not break the chat flow.
   */
  const guardText = useCallback(async (text: string): Promise<GuardResult> => {
    if (!text) {
      return { blocked: false, cleanText: text };
    }
    try {
      const secrets = detectSecrets(text);
      if (!secrets.length) {
        return { blocked: false, cleanText: text };
      }
      if (processing.current) {
        // avoid double-processing on rapid paste+submit
        return { blocked: true, cleanText: '' };
      }
      processing.current = true;
      try {
        const kinds = new Set<string>();
        for (const s of secrets) {
          await saveDetectedSecret(s);
          kinds.add(s.kind);
        }
        const labels = [...kinds].map((k) => KIND_LABEL[k] ?? k);
        flashSecretSaved(labels.join(' + '));
      } finally {
        processing.current = false;
      }
      return { blocked: true, cleanText: '' };
    } catch {
      // Guard infra failure → fail safe: block sending anything secret-like
      const secrets = detectSecrets(text);
      return secrets.length ? { blocked: true, cleanText: '' } : { blocked: false, cleanText: text };
    }
  }, []);

  /** Check a value without side effects (used to pre-validate). */
  const hasSecrets = useCallback((text: string): DetectedSecret[] => detectSecrets(text), []);

  return { guardText, hasSecrets };
}
