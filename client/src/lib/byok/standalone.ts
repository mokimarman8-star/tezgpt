/**
 * TezGPT — Standalone (BYOK) mode detection
 *
 * Standalone mode = no backend server. Auto-detected:
 *  1. Capacitor/Android WebView: origin is https://localhost (androidScheme https)
 *  2. Explicit flag: localStorage 'tezgpt-standalone' === '1'
 *  3. Build-time flag: VITE_STANDALONE === 'true'
 *
 * In standalone mode the app renders the local-first TezGPT Home
 * (Quick Chat + Agent Mode + Keys) — no login, no server needed.
 */

export function isStandalone(): boolean {
  try {
    if (localStorage.getItem('tezgpt-standalone') === '1') {
      return true;
    }
  } catch {
    /* ignore */
  }
  if (import.meta.env?.VITE_STANDALONE === 'true') {
    return true;
  }
  // Capacitor Android serves the app from https://localhost
  if (typeof window !== 'undefined' && window.location?.hostname === 'localhost') {
    return true;
  }
  return false;
}

export function enableStandaloneForTesting(): void {
  try {
    localStorage.setItem('tezgpt-standalone', '1');
  } catch {
    /* ignore */
  }
}

export function disableStandalone(): void {
  try {
    localStorage.removeItem('tezgpt-standalone');
  } catch {
    /* ignore */
  }
}
