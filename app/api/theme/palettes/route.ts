import { NextResponse } from 'next/server';
import { requireUser, unauthorized } from '@/lib/guards';
import { SUGGESTED_SEEDS, VARIANTS, generatePalettes, normalizePalette, parsePalette, previewOf } from '@/lib/theme';

export const runtime = 'nodejs';

/**
 * AJAX: palette cards for the picker.
 *  ?set=suggested            hand-picked starting palettes
 *  ?set=generate&n=8         new random palettes (different every call)
 *  ?set=styles&seed=#RRGGBB  every style of one seed colour
 */
export async function GET(req: Request) {
  const { user } = await requireUser();
  if (!user) return unauthorized();
  const sp = new URL(req.url).searchParams;
  const set = sp.get('set') ?? 'suggested';

  let ids: string[];
  if (set === 'generate') {
    const n = Math.min(Math.max(Number(sp.get('n')) || 8, 1), 16);
    ids = generatePalettes(n, (sp.get('avoid') ?? '').split(',').filter(Boolean));
  } else if (set === 'styles') {
    const seed = parsePalette(sp.get('seed')).seed;
    ids = VARIANTS.map((v) => normalizePalette(v.id === 'tonal' ? seed : `${seed}:${v.id}`));
  } else {
    ids = SUGGESTED_SEEDS.map(normalizePalette);
  }
  return NextResponse.json({ palettes: ids.map(previewOf) }, { headers: { 'Cache-Control': 'no-store' } });
}
