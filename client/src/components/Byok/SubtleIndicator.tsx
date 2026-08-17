/**
 * TezGPT BYOK — SubtleIndicator
 * Discreet pill that appears bottom-center for ~2.8s.
 * Used by the secret guard ("saved to Settings") and other silent events.
 */

import { useEffect, useState } from 'react';
import { onIndicator, type IndicatorPayload } from '~/lib/byok/indicator';

export default function SubtleIndicator() {
  const [payload, setPayload] = useState<IndicatorPayload | null>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    let hideTimer: ReturnType<typeof setTimeout> | null = null;
    const off = onIndicator((p) => {
      setPayload(p);
      setVisible(true);
      if (hideTimer) {
        clearTimeout(hideTimer);
      }
      hideTimer = setTimeout(() => setVisible(false), 2800);
    });
    return () => {
      off();
      if (hideTimer) {
        clearTimeout(hideTimer);
      }
    };
  }, []);

  if (!payload) {
    return null;
  }

  return (
    <div
      aria-live="polite"
      className={`fixed bottom-6 left-1/2 z-[9999] -translate-x-1/2 transition-all duration-300 ${
        visible ? 'translate-y-0 opacity-100' : 'pointer-events-none translate-y-2 opacity-0'
      }`}
    >
      <div className="flex items-center gap-2 rounded-full border border-black/10 bg-white/90 px-4 py-2 text-sm font-medium text-gray-800 shadow-lg backdrop-blur dark:border-white/10 dark:bg-gray-800/90 dark:text-gray-100">
        <span>{payload.text}</span>
      </div>
    </div>
  );
}
