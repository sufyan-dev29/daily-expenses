import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.dailyexpenses.app',
  appName: 'Daily Expenses',
  webDir: 'out',
  server: { androidScheme: 'https', cleartext: false },
  android: { allowMixedContent: false, webContentsDebuggingEnabled: false },
  plugins: {
    // Google Sheets calls go through the native HTTP stack: no CORS rules, and it works on old WebViews.
    CapacitorHttp: { enabled: true },
    CapacitorSQLite: { androidIsEncryption: true, androidBiometric: { biometricAuth: false } },
  },
};

export default config;
