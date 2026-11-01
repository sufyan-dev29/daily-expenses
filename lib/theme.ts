import {
  argbFromHex,
  hexFromArgb,
  Blend,
  Hct,
  MaterialDynamicColors,
  SchemeContent,
  SchemeExpressive,
  SchemeFruitSalad,
  SchemeNeutral,
  SchemeRainbow,
  SchemeTonalSpot,
  SchemeVibrant,
  TonalPalette,
  type DynamicScheme,
} from '@material/material-color-utilities';

import { DEFAULT_SEED, VARIANTS, normalizePalette, paletteId, parsePalette, variantLabel, type Palette, type PalettePreview, type PreviewColors, type Variant } from '@/lib/palette';

export { DEFAULT_SEED, VARIANTS, normalizePalette, paletteId, parsePalette, variantLabel };
export type { Palette, PalettePreview, PreviewColors, Variant };

function makeScheme(p: Palette, dark: boolean): DynamicScheme {
  const hct = Hct.fromInt(argbFromHex(p.seed));
  switch (p.variant) {
    case 'vibrant': return new SchemeVibrant(hct, dark, 0);
    case 'expressive': return new SchemeExpressive(hct, dark, 0);
    case 'neutral': return new SchemeNeutral(hct, dark, 0);
    case 'fruit': return new SchemeFruitSalad(hct, dark, 0);
    case 'rainbow': return new SchemeRainbow(hct, dark, 0);
    case 'content': return new SchemeContent(hct, dark, 0);
    default: return new SchemeTonalSpot(hct, dark, 0);
  }
}

type Scheme = Record<string, string>;

const ROLES: Record<string, { getArgb(s: DynamicScheme): number }> = {
  primary: MaterialDynamicColors.primary,
  'on-primary': MaterialDynamicColors.onPrimary,
  'primary-container': MaterialDynamicColors.primaryContainer,
  'on-primary-container': MaterialDynamicColors.onPrimaryContainer,
  secondary: MaterialDynamicColors.secondary,
  'on-secondary': MaterialDynamicColors.onSecondary,
  'secondary-container': MaterialDynamicColors.secondaryContainer,
  'on-secondary-container': MaterialDynamicColors.onSecondaryContainer,
  tertiary: MaterialDynamicColors.tertiary,
  'on-tertiary': MaterialDynamicColors.onTertiary,
  'tertiary-container': MaterialDynamicColors.tertiaryContainer,
  'on-tertiary-container': MaterialDynamicColors.onTertiaryContainer,
  error: MaterialDynamicColors.error,
  'on-error': MaterialDynamicColors.onError,
  'error-container': MaterialDynamicColors.errorContainer,
  'on-error-container': MaterialDynamicColors.onErrorContainer,
  surface: MaterialDynamicColors.surface,
  'surface-container-lowest': MaterialDynamicColors.surfaceContainerLowest,
  'surface-container-low': MaterialDynamicColors.surfaceContainerLow,
  'surface-container': MaterialDynamicColors.surfaceContainer,
  'surface-container-high': MaterialDynamicColors.surfaceContainerHigh,
  'surface-container-highest': MaterialDynamicColors.surfaceContainerHighest,
  'on-surface': MaterialDynamicColors.onSurface,
  'on-surface-variant': MaterialDynamicColors.onSurfaceVariant,
  outline: MaterialDynamicColors.outline,
  'outline-variant': MaterialDynamicColors.outlineVariant,
  'inverse-surface': MaterialDynamicColors.inverseSurface,
  'inverse-on-surface': MaterialDynamicColors.inverseOnSurface,
  'inverse-primary': MaterialDynamicColors.inversePrimary,
  scrim: MaterialDynamicColors.scrim,
};

/** A semantic family (expense / income) harmonized a little toward the seed so it never clashes. */
function family(sourceHex: string, seedArgb: number, dark: boolean) {
  const harmonized = Blend.harmonize(argbFromHex(sourceHex), seedArgb);
  const hct = Hct.fromInt(harmonized);
  const p = TonalPalette.fromHueAndChroma(hct.hue, Math.max(hct.chroma, 48));
  return dark
    ? { main: hexFromArgb(p.tone(80)), container: hexFromArgb(p.tone(30)), on: hexFromArgb(p.tone(90)) }
    : { main: hexFromArgb(p.tone(40)), container: hexFromArgb(p.tone(90)), on: hexFromArgb(p.tone(10)) };
}

/**
 * Eight clearly different hues for categories, banks, payment modes and sources.
 * Fixed hue steps (so neighbours never look alike), nudged slightly toward the seed (cohesive with the theme).
 */
const CAT_HUES = [28, 62, 112, 158, 196, 238, 282, 330];

export function buildScheme(paletteRaw: string, dark: boolean): Scheme {
  const p = parsePalette(paletteRaw);
  const seedArgb = argbFromHex(p.seed);
  const s = makeScheme(p, dark);
  const out: Scheme = {};
  for (const [name, role] of Object.entries(ROLES)) out[name] = hexFromArgb(role.getArgb(s));

  const exp = family('#D8664A', seedArgb, dark);
  const inc = family('#2E9D5B', seedArgb, dark);
  out.expense = exp.main;
  out['expense-container'] = exp.container;
  out['on-expense-container'] = exp.on;
  out.income = inc.main;
  out['income-container'] = inc.container;
  out['on-income-container'] = inc.on;

  CAT_HUES.forEach((hue, i) => {
    const argb = Blend.harmonize(Hct.from(hue, 60, 55).toInt(), seedArgb);
    const h = Hct.fromInt(argb);
    const pal = TonalPalette.fromHueAndChroma(h.hue, 52);
    out[`cat-${i + 1}`] = hexFromArgb(pal.tone(dark ? 80 : 38));
    out[`cat-${i + 1}-c`] = hexFromArgb(pal.tone(dark ? 26 : 90));
  });
  return out;
}

function block(scheme: Scheme): string {
  return Object.entries(scheme)
    .map(([k, v]) => (k.startsWith('cat-') ? `--${k}:${v};` : `--md-sys-color-${k}:${v};`))
    .join('');
}

/** CSS for both schemes. Light is the default; dark applies via class on <html>. */
export function themeCss(paletteRaw: string): string {
  const light = buildScheme(paletteRaw, false);
  const dark = buildScheme(paletteRaw, true);
  return `:root{color-scheme:light;${block(light)}}html.dark{color-scheme:dark;${block(dark)}}`;
}

export function themeColors(paletteRaw: string) {
  return {
    light: buildScheme(paletteRaw, false)['surface'],
    dark: buildScheme(paletteRaw, true)['surface'],
  };
}

/* ------------------------------------------------------------------ previews for the picker */
function previewColors(p: Palette, dark: boolean): PreviewColors {
  const s = buildScheme(paletteId(p), dark);
  return {
    primary: s.primary,
    secondary: s.secondary,
    tertiary: s.tertiary,
    primaryContainer: s['primary-container'],
    secondaryContainer: s['secondary-container'],
    tertiaryContainer: s['tertiary-container'],
    surface: s['surface-container-high'],
    onSurface: s['on-surface'],
  };
}

export function previewOf(raw: string): PalettePreview {
  const p = parsePalette(raw);
  return { id: paletteId(p), seed: p.seed, variant: p.variant, label: variantLabel(p.variant), light: previewColors(p, false), dark: previewColors(p, true) };
}

/** Hand-picked starting palettes (all tonal spot). */
export const SUGGESTED_SEEDS = ['#006A6A', '#0B57D0', '#6750A4', '#B3261E', '#9A5B00', '#386A20', '#984061', '#4A5568'];

/** Random, good-looking palettes. Hues are spread around the wheel; chroma and style vary. */
export function generatePalettes(count: number, avoid: string[] = []): string[] {
  const out: string[] = [];
  const seen = new Set(avoid.map((a) => normalizePalette(a)));
  const styles: Variant[] = ['tonal', 'tonal', 'vibrant', 'expressive', 'fruit', 'rainbow', 'content', 'neutral'];
  const start = Math.random() * 360;
  let guard = 0;
  while (out.length < count && guard++ < 200) {
    const hue = (start + out.length * (360 / count) + (Math.random() - 0.5) * 24 + 360) % 360;
    const chroma = 38 + Math.random() * 46;
    const tone = 40 + Math.random() * 16;
    const seed = hexFromArgb(Hct.from(hue, chroma, tone).toInt()).toUpperCase();
    const variant = styles[Math.floor(Math.random() * styles.length)];
    const id = paletteId({ seed, variant });
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

/** Inline script that runs before first paint: picks light/dark with no flash. */
export const NO_FLASH_SCRIPT = `(function(){try{var m=localStorage.getItem('et-theme')||'system';var d=m==='dark'||(m==='system'&&window.matchMedia('(prefers-color-scheme: dark)').matches);document.documentElement.classList.toggle('dark',d);var c=document.querySelector('meta[name=theme-color]');if(c){var s=getComputedStyle(document.documentElement).getPropertyValue('--md-sys-color-surface');if(s)c.setAttribute('content',s.trim());}}catch(e){}})();`;
