import type { CapacitorConfig } from '@capacitor/cli';

// The Android app is a thin wrapper around the live website, so every update to the
// website reaches auditors instantly without reinstalling. The wrapper adds what a
// browser cannot do: GPS tracking that keeps running with the screen locked.
//
// APP_URL is your deployed address, e.g. https://tj-stock-audit.pages.dev
const url = process.env.APP_URL;

const config: CapacitorConfig = {
  appId: 'com.sjbj.stockaudit',
  appName: 'Stock Audit',
  webDir: 'dist',
  ...(url ? { server: { url, cleartext: false } } : {}),
  android: { allowMixedContent: false },
};

export default config;
