// Pure palette helpers: no colour maths here, so this file is safe (and tiny) in the browser bundle.
export const DEFAULT_SEED = '#006A6A';

/* ------------------------------------------------------------------ palettes
 * A palette = one seed colour + one Material colour "style" (variant).
 * It is stored as a single string in user_settings.accent_hex: "#RRGGBB" (tonal spot)
 * or "#RRGGBB:vibrant". That keeps the database schema unchanged.
 */
export type Variant = 'tonal' | 'vibrant' | 'expressive' | 'neutral' | 'fruit' | 'rainbow' | 'content';

export const VARIANTS: { id: Variant; label: string }[] = [
  { id: 'tonal', label: 'Tonal spot' },
  { id: 'vibrant', label: 'Vibrant' },
  { id: 'expressive', label: 'Expressive' },
  { id: 'neutral', label: 'Neutral' },
  { id: 'fruit', label: 'Fruit salad' },
  { id: 'rainbow', label: 'Rainbow' },
  { id: 'content', label: 'Faithful' },
];

export interface Palette {
  seed: string;
  variant: Variant;
}

const HEX = /^#[0-9a-fA-F]{6}$/;
const isVariant = (v: string): v is Variant => VARIANTS.some((x) => x.id === v);

export function parsePalette(raw: string | null | undefined): Palette {
  const [hex, v] = String(raw ?? '').split(':');
  return { seed: HEX.test(hex ?? '') ? hex.toUpperCase() : DEFAULT_SEED, variant: v && isVariant(v) ? v : 'tonal' };
}
export const paletteId = (p: Palette) => (p.variant === 'tonal' ? p.seed : `${p.seed}:${p.variant}`);
export const normalizePalette = (raw: string | null | undefined) => paletteId(parsePalette(raw));
export const variantLabel = (v: Variant) => VARIANTS.find((x) => x.id === v)?.label ?? v;


export interface PalettePreview {
  id: string;
  seed: string;
  variant: Variant;
  label: string;
  light: PreviewColors;
  dark: PreviewColors;
}
export interface PreviewColors {
  primary: string;
  secondary: string;
  tertiary: string;
  primaryContainer: string;
  secondaryContainer: string;
  tertiaryContainer: string;
  surface: string;
  onSurface: string;
}

