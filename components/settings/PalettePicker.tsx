'use client';
import { useCallback, useEffect, useState } from 'react';
import { Button, Icon, Spinner, cx, useIsDark, useSnackbar } from '@/components/ui';
import { useApp } from '@/components/AppProvider';
import { normalizePalette, parsePalette, type PalettePreview } from '@/lib/palette';
import { SUGGESTED_SEEDS, VARIANTS, generatePalettes, previewOf } from '@/lib/theme';

/** Palettes are generated on the phone. qs is the same query format the old server route used. */
async function load(qs: string): Promise<PalettePreview[] | null> {
  try {
    const sp = new URLSearchParams(qs);
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
    return ids.map(previewOf);
  } catch {
    return null;
  }
}

/** One palette as a card: a round swatch split into primary / tertiary / secondary / container. */
function PaletteCard({ p, dark, selected, onSelect, delay = 0, caption }: { p: PalettePreview; dark: boolean; selected: boolean; onSelect: () => void; delay?: number; caption?: string }) {
  const c = dark ? p.dark : p.light;
  return (
    <div className="rise flex flex-col items-center gap-1.5" style={{ animationDelay: `${delay}ms` }}>
      <button
        type="button"
        onClick={onSelect}
        aria-pressed={selected}
        aria-label={`${p.label} palette from ${p.seed}${selected ? ', selected' : ''}`}
        className={cx(
          'press relative aspect-square w-full rounded-[28px] p-2.5 transition-[box-shadow] duration-300',
          selected ? 'shadow-[0_0_0_3px_var(--md-sys-color-primary)]' : 'shadow-[0_0_0_0_transparent]',
        )}
        style={{ background: c.surface }}
      >
        <span className="grid h-full w-full grid-cols-2 grid-rows-2 overflow-hidden rounded-full">
          <i style={{ background: c.primary }} />
          <i style={{ background: c.tertiary }} />
          <i style={{ background: c.secondary }} />
          <i style={{ background: c.primaryContainer }} />
        </span>
        {selected && (
          <span key="sel" className="pop absolute inset-0 m-auto flex h-7 w-7 items-center justify-center rounded-full" style={{ background: c.surface, color: c.primary }}>
            <Icon name="check" size={18} />
          </span>
        )}
      </button>
      {caption && <span className={cx('t-label-md text-center leading-4', selected ? 'text-on-surface' : 'text-on-surface-variant')}>{caption}</span>}
    </div>
  );
}

function Grid({ children }: { children: React.ReactNode }) {
  return <div className="grid grid-cols-4 gap-x-3 gap-y-4 expanded:grid-cols-8">{children}</div>;
}
function Placeholders({ n }: { n: number }) {
  return (
    <Grid>
      {Array.from({ length: n }).map((_, i) => (
        <div key={i} className="skeleton aspect-square w-full rounded-[28px]" />
      ))}
    </Grid>
  );
}

export function PalettePicker() {
  const { settings, setSettings } = useApp();
  const snack = useSnackbar();
  const dark = useIsDark();
  const current = normalizePalette(settings.accent_hex);
  const cur = parsePalette(current);

  const [suggested, setSuggested] = useState<PalettePreview[] | null>(null);
  const [generated, setGenerated] = useState<PalettePreview[] | null>(null);
  const [styles, setStyles] = useState<PalettePreview[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [hex, setHex] = useState(cur.seed);

  useEffect(() => { load('set=suggested').then(setSuggested); }, []);
  useEffect(() => {
    let alive = true;
    load(`set=styles&seed=${encodeURIComponent(cur.seed)}`).then((r) => alive && setStyles(r));
    setHex(cur.seed);
    return () => { alive = false; };
  }, [cur.seed]);

  const choose = useCallback(async (id: string) => {
    if (normalizePalette(id) === current) return;
    const err = await setSettings({ accent_hex: id });
    if (err) snack({ message: err });
  }, [current, setSettings, snack]);

  const generate = async () => {
    setBusy(true);
    const avoid = [...(generated ?? []), ...(suggested ?? [])].map((p) => p.id).join(',');
    const r = await load(`set=generate&n=8&avoid=${encodeURIComponent(avoid)}`);
    setBusy(false);
    if (r) setGenerated(r);
    else snack({ message: 'Could not generate palettes.' });
  };

  const main = generated ?? suggested;
  const validHex = /^#[0-9a-fA-F]{6}$/.test(hex);

  return (
    <div>
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <div className="t-title-md">Colour palette</div>
          <div className="t-body-md text-on-surface-variant">{generated ? 'Generated for you' : 'Suggested'}. Tap one to try it instantly.</div>
        </div>
        <Button variant="tonal" onClick={generate} disabled={busy} className="shrink-0 !px-4" aria-label="Generate new palettes">
          {busy ? <Spinner size={18} /> : <Icon name="auto_awesome" size={18} fill />}
          Generate
        </Button>
      </div>

      {main ? (
        <Grid>
          {main.map((p, i) => (
            <PaletteCard key={p.id} p={p} dark={dark} selected={p.id === current} delay={i * 28} onSelect={() => choose(p.id)} />
          ))}
        </Grid>
      ) : (
        <Placeholders n={8} />
      )}

      <div className="t-title-md mb-1 mt-6">Style</div>
      <div className="t-body-md mb-3 text-on-surface-variant">Same colour, different personality.</div>
      {styles ? (
        <Grid>
          {styles.map((p, i) => (
            <PaletteCard key={p.id} p={p} dark={dark} selected={p.id === current} delay={i * 28} caption={p.label} onSelect={() => choose(p.id)} />
          ))}
        </Grid>
      ) : (
        <Placeholders n={7} />
      )}

      <div className="t-title-md mb-3 mt-6">Your own colour</div>
      <div className="flex items-center gap-3">
        <label className="relative h-14 w-14 shrink-0 cursor-pointer overflow-hidden rounded-2xl" style={{ background: validHex ? hex : cur.seed }}>
          <span className="sr-only">Pick a colour</span>
          <input type="color" value={validHex ? hex : cur.seed} onChange={(e) => setHex(e.target.value.toUpperCase())} className="absolute inset-0 h-full w-full cursor-pointer opacity-0" />
        </label>
        <input
          aria-label="Hex colour"
          value={hex}
          onChange={(e) => setHex(e.target.value.startsWith('#') ? e.target.value : `#${e.target.value}`)}
          maxLength={7}
          spellCheck={false}
          className="t-body-lg h-14 min-w-0 flex-1 rounded-2xl border-2 border-transparent bg-surface-container-high px-4 font-mono uppercase transition-colors focus:border-primary focus:outline-none"
        />
        <Button variant="filled" disabled={!validHex || hex.toUpperCase() === cur.seed} onClick={() => choose(cur.variant === 'tonal' ? hex.toUpperCase() : `${hex.toUpperCase()}:${cur.variant}`)}>
          Apply
        </Button>
      </div>
    </div>
  );
}
