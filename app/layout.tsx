import type { Metadata, Viewport } from 'next';
import '@fontsource-variable/inter';
import 'material-symbols/rounded.css';
import './globals.css';
import { DEFAULT_SEED, NO_FLASH_SCRIPT, themeCss, themeColors } from '@/lib/theme';
import { SessionProvider } from '@/components/auth/SessionProvider';
import { AuthGate } from '@/components/auth/AuthGate';

export const metadata: Metadata = {
  title: 'Daily Expenses',
  description: 'Private expense and income tracker',
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: themeColors(DEFAULT_SEED).light,
};

// Everything is bundled in the app. The only outside connections are the two Google hosts used by the optional Sheet sync.
const CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self' https://sheets.googleapis.com https://oauth2.googleapis.com",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join('; ');

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <meta httpEquiv="Content-Security-Policy" content={CSP} />
        <style id="theme-vars" dangerouslySetInnerHTML={{ __html: themeCss(DEFAULT_SEED) }} />
        <meta name="theme-color" content={themeColors(DEFAULT_SEED).light} />
        <script dangerouslySetInnerHTML={{ __html: NO_FLASH_SCRIPT }} />
      </head>
      <body>
        <SessionProvider>
          <AuthGate>{children}</AuthGate>
        </SessionProvider>
      </body>
    </html>
  );
}
