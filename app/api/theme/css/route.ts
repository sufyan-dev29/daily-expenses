import { NextResponse } from 'next/server';
import { requireUser, unauthorized } from '@/lib/guards';
import { normalizePalette, themeColors, themeCss } from '@/lib/theme';

export const runtime = 'nodejs';

/** AJAX: the CSS variables for a palette, so the app can re-theme itself without reloading. */
export async function GET(req: Request) {
  const { user } = await requireUser();
  if (!user) return unauthorized();
  const raw = new URL(req.url).searchParams.get('palette');
  const palette = normalizePalette(raw);
  return NextResponse.json(
    { palette, css: themeCss(palette), surface: themeColors(palette) },
    { headers: { 'Cache-Control': 'private, max-age=3600' } },
  );
}
