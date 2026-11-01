import type { Metadata, Viewport } from 'next';
import '@fontsource-variable/inter';
import 'material-symbols/rounded.css';
import './globals.css';
import { DEFAULT_SEED, NO_FLASH_SCRIPT, themeCss, themeColors } from '@/lib/theme';

export const metadata: Metadata = {
  title: { default: 'Expense tracker', template: '%s · Expense tracker' },
  description: 'Private expense and income tracker',
  robots: { index: false, follow: false },
  manifest: '/manifest.webmanifest',
  appleWebApp: { capable: true, title: 'Expenses', statusBarStyle: 'default' },
  icons: { icon: [{ url: '/icons/192?v=2', sizes: '192x192', type: 'image/png' }], apple: [{ url: '/icons/apple?v=2', sizes: '180x180' }] },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: themeColors(DEFAULT_SEED).light,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <style id="theme-vars" dangerouslySetInnerHTML={{ __html: themeCss(DEFAULT_SEED) }} />
        <meta name="theme-color" content={themeColors(DEFAULT_SEED).light} />
        <script dangerouslySetInnerHTML={{ __html: NO_FLASH_SCRIPT }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
