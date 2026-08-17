/**
 * TezGPT BYOK — Subtle indicator bus.
 * A tiny pub/sub so any part of the app can flash a discreet
 * "saved to Settings" pill without prop drilling or popups.
 */

export interface IndicatorPayload {
  text: string;
  tone?: 'ok' | 'warn';
  icon?: string;
}

type Listener = (p: IndicatorPayload) => void;

let listener: Listener | null = null;

export function onIndicator(fn: Listener): () => void {
  listener = fn;
  return () => {
    if (listener === fn) {
      listener = null;
    }
  };
}

export function flashIndicator(payload: IndicatorPayload): void {
  listener?.(payload);
}

/** Convenience: the "secret saved" flash used by the paste guard. */
export function flashSecretSaved(kindLabel: string): void {
  flashIndicator({ text: `🔒 ${kindLabel} saved to Settings — not sent anywhere`, tone: 'ok' });
}
