import type { CapacitorConfig } from '@capacitor/cli';

/**
 * TezGPT — Android app config.
 * Wraps the built PWA (client/dist) into a native APK.
 */
const config: CapacitorConfig = {
  appId: 'app.tezgpt.android',
  appName: 'TezGPT',
  webDir: 'client/dist',
  bundledWebRuntime: false,
  backgroundColor: '#0e0e18',
  plugins: {
    SplashScreen: {
      launchShowDuration: 800,
      backgroundColor: '#0e0e18',
      showSpinner: false,
      androidSplashResourceName: 'splash',
    },
  },
  android: {
    allowMixedContent: false,
  },
  server: {
    androidScheme: 'https',
    cleartext: true,
  },
};

export default config;
