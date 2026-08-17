/**
 * TezGPT — Download App banner (landing page)
 * 📱 Android APK direct download + Play Store (Coming Soon)
 */

import { Download, Smartphone } from 'lucide-react';
import { APP_DOWNLOAD_URL } from '~/constants/downloadLinks';

export default function DownloadAppBanner() {
  return (
    <div className="animate-fadeIn mt-6 flex flex-col items-center gap-3">
      <div className="flex flex-wrap items-center justify-center gap-2">
        <a
          href={APP_DOWNLOAD_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-2 rounded-full bg-accent-primary px-4 py-2 text-sm font-semibold text-white shadow-sm transition-transform hover:scale-[1.03] hover:bg-accent-primary-hover"
        >
          <Download size={15} />
          Download Android App
        </a>
        <span className="relative inline-flex">
          <span
            className="flex cursor-not-allowed items-center gap-2 rounded-full border border-border-medium px-4 py-2 text-sm font-medium text-text-tertiary"
            title="Play Store listing coming soon"
          >
            <Smartphone size={15} />
            Play Store
          </span>
          <span className="absolute -top-2 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-full bg-purple-500/15 px-2 py-0.5 text-[10px] font-bold text-purple-500">
            Coming Soon
          </span>
        </span>
      </div>
      <p className="max-w-xs text-center text-xs text-text-tertiary">
        Install the APK on Android — enable “Install from unknown sources” when prompted.
      </p>
      <span className="text-[11px] text-text-tertiary">
        Play Store listing coming soon → app.tezgpt.android
      </span>
    </div>
  );
}
