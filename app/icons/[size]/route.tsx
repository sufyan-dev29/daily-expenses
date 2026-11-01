import { ImageResponse } from 'next/og';
import { DEFAULT_SEED, buildScheme } from '@/lib/theme';

export const runtime = 'edge';

/**
 * App icon in the same Material You language as the UI: a tonal wallet with a coin peeking out.
 *  /icons/192, /icons/512  rounded square (Android, favicon)
 *  /icons/maskable          full-bleed, glyph inside the 80% safe zone (Android adaptive icons)
 *  /icons/apple             full-bleed 180px (iOS rounds the corners itself)
 */
export async function GET(_req: Request, { params }: { params: Promise<{ size: string }> }) {
  const { size } = await params;
  const full = size === 'maskable' || size === 'apple';
  const px = size === '192' ? 192 : size === 'apple' ? 180 : 512;
  const s = buildScheme(DEFAULT_SEED, false);
  const k = full ? 0.74 : 0.9; // glyph scale inside the 512 box
  const radius = full ? 0 : px * 0.225;

  return new ImageResponse(
    (
      <div style={{ width: px, height: px, display: 'flex', background: s.primary, borderRadius: radius, overflow: 'hidden' }}>
        <svg width={px} height={px} viewBox="0 0 512 512">
          <defs>
            <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0" stopColor={s.primary} />
              <stop offset="1" stopColor={s['on-primary-container']} />
            </linearGradient>
          </defs>
          <rect width="512" height="512" fill="url(#g)" />
          <circle cx="400" cy="96" r="150" fill={s['primary-container']} opacity="0.16" />
          <g transform={`translate(256 256) scale(${k}) translate(-256 -256)`}>
            {/* coin peeking out of the wallet */}
            <circle cx="322" cy="168" r="58" fill={s['tertiary-container']} />
            <circle cx="322" cy="168" r="38" fill="none" stroke={s.tertiary} strokeWidth="9" opacity="0.55" />
            {/* wallet body */}
            <rect x="92" y="200" width="328" height="232" rx="56" fill={s['primary-container']} />
            {/* flap shadow strip */}
            <path d="M92 270 V256 A56 56 0 0 1 148 200 H364 A56 56 0 0 1 420 256 V270 Z" fill={s['secondary-container']} />
            {/* clasp tab */}
            <rect x="312" y="306" width="150" height="84" rx="42" fill={s['on-primary']} />
            <circle cx="360" cy="348" r="17" fill={s.primary} />
          </g>
        </svg>
      </div>
    ),
    { width: px, height: px },
  );
}
