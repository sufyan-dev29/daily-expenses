import type { MetadataRoute } from 'next';
import { DEFAULT_SEED, themeColors } from '@/lib/theme';

export default function manifest(): MetadataRoute.Manifest {
  const c = themeColors(DEFAULT_SEED);
  return {
    name: 'Expense tracker',
    short_name: 'Expenses',
    start_url: '/expense',
    scope: '/',
    display: 'standalone',
    orientation: 'any',
    background_color: c.light,
    theme_color: c.light,
    icons: [
      { src: '/icons/192?v=2', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icons/512?v=2', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icons/maskable?v=2', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}
