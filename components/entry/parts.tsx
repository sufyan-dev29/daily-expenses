'use client';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Button, Field, Icon, Sheet, Spinner, cx } from '@/components/ui';
import { useApp } from '@/components/AppProvider';
import { iconForOption } from '@/lib/seed';
import { ColorRow, IconRow } from '@/components/IconColorPicker';
import type { Option, OptionKind } from '@/lib/types';

/* ---------------------------------------------------------------- option look (every option gets its own colour) */
const KIND_OFFSET: Record<string, number> = { category: 0, bank: 0, payment_mode: 4, income_source: 2 };
export function optionLook(o: Option | undefined | null, all: Option[]) {
  if (!o) return { bg: 'var(--md-sys-color-surface-container-highest)', fg: 'var(--md-sys-color-on-surface-variant)', n: 0 };
  let n = /^[1-8]$/.test(o.color ?? '') ? Number(o.color) : 0;
  if (!n) {
    const same = all.filter((x) => x.kind === o.kind).sort((a, b) => a.sort_order - b.sort_order);
    // each kind starts at a different colour, so a bank and a payment mode shown side by side never match
    n = ((Math.max(0, same.findIndex((x) => x.id === o.id)) + (KIND_OFFSET[o.kind] ?? 0)) % 8) + 1;
  }
  return { bg: `var(--cat-${n}-c)`, fg: `var(--cat-${n})`, n };
}
/** Kept for older call sites. */
export const catLook = optionLook;

export const iconOf = (o: Option | undefined | null) => (o ? iconForOption(o.kind, o.name, o.icon) : 'sell');

/** Round coloured badge with the option's icon. */
export function OptionAvatar({ option, all, size = 40, className }: { option: Option | undefined | null; all: Option[]; size?: number; className?: string }) {
  const look = optionLook(option, all);
  return (
    <span className={cx('flex shrink-0 items-center justify-center rounded-full', className)} style={{ width: size, height: size, background: look.bg, color: look.fg }}>
      <Icon name={iconOf(option)} size={Math.round(size * 0.55)} fill />
    </span>
  );
}

/** Small coloured pill (bank, payment mode …) for lists. */
export function OptionPill({ option, all }: { option: Option | undefined | null; all: Option[] }) {
  if (!option) return null;
  const look = optionLook(option, all);
  return (
    <span className="inline-flex min-w-0 max-w-full shrink items-center rounded-full px-2.5 py-0.5 text-[11px] font-semibold leading-4" style={{ background: look.bg, color: look.fg }}>
      <span className="truncate">{option.name}</span>
    </span>
  );
}

/* ---------------------------------------------------------------- sentence token */
export function Token({
  children,
  onClick,
  empty,
  label,
  className,
  option,
  all,
  icon,
}: {
  children: ReactNode;
  onClick: () => void;
  empty?: boolean;
  label: string;
  className?: string;
  /** when set, the chip takes this option's own colour and icon */
  option?: Option | null;
  all?: Option[];
  icon?: string;
}) {
  const look = option && all ? optionLook(option, all) : null;
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      style={look ? { background: look.bg, color: look.fg } : undefined}
      className={cx(
        'state press t-body-lg inline-flex min-h-[44px] max-w-full items-center gap-2 rounded-2xl pl-3 pr-2.5 align-middle',
        !look && (empty ? 'bg-surface-container-high text-on-surface-variant' : 'bg-secondary-container text-on-secondary-container font-semibold'),
        look && 'font-semibold',
        className,
      )}
    >
      {(option || icon) && (
        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full" style={look ? { background: look.fg, color: look.bg } : undefined}>
          <Icon name={option ? iconOf(option) : icon!} size={15} fill />
        </span>
      )}
      <span key={String(children)} className="tick truncate">{children}</span>
      <Icon name="expand_more" size={18} className="shrink-0 opacity-70" />
    </button>
  );
}

/* ---------------------------------------------------------------- select sheet */
export function SelectSheet({
  open,
  onClose,
  title,
  items,
  selectedId,
  onSelect,
  onAdd,
  allowClear,
  kind,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  items: Option[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onAdd?: (name: string, look: { icon: string; color: string | null }) => Promise<string | null>;
  allowClear?: boolean;
  kind?: OptionKind;
}) {
  const { options: all } = useApp();
  const [q, setQ] = useState('');
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState('');
  const [err, setErr] = useState('');
  const [icon, setIcon] = useState<string | null>(null); // null = follow the name
  const [color, setColor] = useState('');
  useEffect(() => {
    if (open) { setQ(''); setAdding(false); setNewName(''); setErr(''); setIcon(null); setColor(''); }
  }, [open]);

  const shown = useMemo(() => items.filter((i) => i.name.toLowerCase().includes(q.toLowerCase())), [items, q]);

  const pick = (id: string | null) => { onSelect(id); onClose(); };

  // live preview of the option being added: icon follows the name until the person picks one
  const k: OptionKind = kind ?? items[0]?.kind ?? 'category';
  const shownIcon = icon ?? iconForOption(k, newName, null);
  const preview: Option = { id: '__new__', kind: k, name: newName, sort_order: items.length, color: color || null, icon: shownIcon, archived_at: null };

  const add = async () => {
    const name = newName.trim();
    if (!name || !onAdd) return;
    const id = await onAdd(name, { icon: shownIcon, color: color || null });
    if (id) pick(id);
    else setErr('Could not add (it may already exist).');
  };

  return (
    <Sheet open={open} onClose={onClose} title={title}>
      {items.length > 7 && (
        <div className="px-4 pb-2">
          <Field label="Search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Type to filter" enterKeyHint="search" />
        </div>
      )}
      <ul role="listbox" aria-label={title}>
        {allowClear && (
          <li>
            <button className="state press t-body-lg flex min-h-[56px] w-full items-center gap-3 rounded-full py-1.5 pl-2.5 pr-4 text-left text-on-surface-variant" onClick={() => pick(null)}>
              <span className="flex h-10 w-10 items-center justify-center rounded-full bg-surface-container-highest"><Icon name="block" size={22} /></span> None
            </button>
          </li>
        )}
        {shown.map((o, i) => {
          const sel = o.id === selectedId;
          const look = optionLook(o, all);
          return (
            <li key={o.id} className="rise" style={{ animationDelay: `${Math.min(i, 8) * 22}ms` }}>
              <button
                role="option"
                aria-selected={sel}
                onClick={() => pick(o.id)}
                style={sel ? { background: look.bg } : undefined}
                className="state press t-body-lg flex min-h-[60px] w-full items-center gap-3 rounded-full py-1.5 pl-2.5 pr-4 text-left"
              >
                <OptionAvatar option={o} all={all} size={40} />
                <span className={cx('flex-1 truncate', sel && 'font-semibold')} style={sel ? { color: look.fg } : undefined}>{o.name}</span>
                {sel && <Icon name="check_circle" fill className="tick" />}
              </button>
            </li>
          );
        })}
        {!shown.length && <li className="t-body-md px-4 py-6 text-center text-on-surface-variant">No matches</li>}
      </ul>
      {onAdd && (
        <div className="px-2 pt-1">
          {adding ? (
            <div ref={(el) => el?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })} className="rise flex flex-col gap-3 px-2 pb-3">
              <div className="flex items-start gap-3">
                <span className="mt-1 flex h-14 w-14 shrink-0 items-center justify-center rounded-full transition-colors duration-300" style={{ background: optionLook(preview, [...all, preview]).bg, color: optionLook(preview, [...all, preview]).fg }}>
                  <Icon name={shownIcon} size={28} fill className="tick" key={shownIcon} />
                </span>
                <Field className="flex-1" label="New name" value={newName} onChange={(e) => setNewName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && add()} error={err || undefined} />
              </div>
              <div className="px-1">
                <div className="t-label-md mb-1.5 text-on-surface-variant">Icon{icon === null && newName.trim() ? ' (picked from the name, tap to change)' : ''}</div>
                <IconRow value={shownIcon} onChange={setIcon} />
              </div>
              <div className="px-1">
                <div className="t-label-md mb-1.5 text-on-surface-variant">Colour</div>
                <ColorRow value={color} onChange={setColor} />
              </div>
              <Button onClick={add} disabled={!newName.trim()}>Add</Button>
            </div>
          ) : (
            <button className="state press t-body-lg flex min-h-[56px] w-full items-center gap-3 rounded-full py-1.5 pl-2.5 pr-4 text-left text-primary" onClick={() => setAdding(true)}>
              <span className="flex h-10 w-10 items-center justify-center rounded-full bg-primary-container text-on-primary-container"><Icon name="add" size={22} /></span> Add new…
            </button>
          )}
        </div>
      )}
    </Sheet>
  );
}

/* ---------------------------------------------------------------- amount pad */
export function AmountPad({
  open,
  onClose,
  value,
  onChange,
  prefix,
}: {
  open: boolean;
  onClose: () => void;
  value: string;
  onChange: (v: string) => void;
  prefix: string;
}) {
  const press = useCallback(
    (k: string) => {
      if (k === 'back') return onChange(value.slice(0, -1));
      if (k === '.') {
        if (value.includes('.')) return;
        return onChange((value || '0') + '.');
      }
      if (value.includes('.') && value.split('.')[1].length >= 2) return;
      if (value.replace('.', '').length >= 12) return;
      onChange(value === '0' ? k : value + k);
    },
    [value, onChange],
  );

  useEffect(() => {
    if (!open) return;
    const f = (e: KeyboardEvent) => {
      if (/^[0-9.]$/.test(e.key)) { e.preventDefault(); press(e.key); }
      else if (e.key === 'Backspace') { e.preventDefault(); press('back'); }
      else if (e.key === 'Enter') { e.preventDefault(); onClose(); }
    };
    document.addEventListener('keydown', f);
    return () => document.removeEventListener('keydown', f);
  }, [open, press, onClose]);

  const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '.', '0', 'back'];
  const shown = value ? Number(value).toLocaleString('en-US', { maximumFractionDigits: 0 }) + (value.includes('.') ? '.' + value.split('.')[1] : '') : '0';
  return (
    <Sheet open={open} onClose={onClose} title="Amount" footer={<Button className="h-14 w-full" onClick={onClose}>Done</Button>}>
      <div className="px-6 pb-4 pt-2 text-center">
        <span className="t-label-lg mr-2 text-on-surface-variant">{prefix}</span>
        <span key={shown} className="t-display tick inline-block" aria-live="polite">{shown}</span>
      </div>
      <div className="grid grid-cols-3 gap-2 px-4 pb-2">
        {keys.map((k) => (
          <button
            key={k}
            type="button"
            aria-label={k === 'back' ? 'Delete last digit' : k === '.' ? 'Decimal point' : k}
            onClick={() => press(k)}
            className="state press t-headline flex h-16 items-center justify-center rounded-3xl bg-surface-container-high"
          >
            {k === 'back' ? <Icon name="backspace" /> : k}
          </button>
        ))}
      </div>
    </Sheet>
  );
}

/* ---------------------------------------------------------------- date sheet */
export function DateSheet({ open, onClose, value, onChange, today }: { open: boolean; onClose: () => void; value: string; onChange: (v: string) => void; today: string }) {
  const yesterday = useMemo(() => {
    const d = new Date(today + 'T00:00:00');
    d.setDate(d.getDate() - 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }, [today]);
  return (
    <Sheet open={open} onClose={onClose} title="Date">
      <div className="flex gap-2 px-4 pb-3">
        <button className={cx('state press t-label-lg h-10 rounded-full px-4', value === today ? 'bg-secondary-container text-on-secondary-container' : 'bg-surface-container-high')} onClick={() => { onChange(today); onClose(); }}>Today</button>
        <button className={cx('state press t-label-lg h-10 rounded-full px-4', value === yesterday ? 'bg-secondary-container text-on-secondary-container' : 'bg-surface-container-high')} onClick={() => { onChange(yesterday); onClose(); }}>Yesterday</button>
      </div>
      <div className="px-4 pb-4">
        <Field label="Pick a date" type="date" value={value} max={today} onChange={(e) => e.target.value && onChange(e.target.value)} />
        <Button className="mt-4 w-full" onClick={onClose}>Done</Button>
      </div>
    </Sheet>
  );
}

/* ---------------------------------------------------------------- success button
 * idle -> saving (shrinks to a circle, spinner) -> done (check draws itself, soft ring) -> idle.
 * Pure state + CSS: nothing imperative, nothing that can get stuck. */
type Phase = 'idle' | 'saving' | 'done';

export function SuccessButton({
  label,
  disabled,
  onSubmit,
}: {
  label: string;
  disabled: boolean;
  /** Resolve true when saved (or queued offline). The form is cleared by the caller on success. */
  onSubmit: () => Promise<boolean>;
}) {
  const [phase, setPhase] = useState<Phase>('idle');
  const busy = useRef(false);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      timers.current.forEach(clearTimeout);
    };
  }, []);
  const later = (fn: () => void, ms: number) => {
    timers.current.push(setTimeout(() => alive.current && fn(), ms));
  };

  const run = async () => {
    if (busy.current || disabled) return;
    busy.current = true;
    setPhase('saving');
    const t0 = Date.now();
    let ok = false;
    try {
      ok = await onSubmit();
    } catch {
      ok = false;
    }
    if (!ok) {
      setPhase('idle');
      busy.current = false;
      return;
    }
    // let the shrink finish so it never looks abrupt, then draw the check
    const wait = Math.max(0, 280 - (Date.now() - t0));
    later(() => {
      setPhase('done');
      try { navigator.vibrate?.(15); } catch {}
    }, wait);
    later(() => {
      setPhase('idle');
      busy.current = false;
    }, wait + 1200);
  };

  const circle = phase !== 'idle';
  return (
    <div className="flex h-14 justify-center">
      <button
        type="button"
        onClick={run}
        disabled={disabled && phase === 'idle'}
        aria-label={phase === 'done' ? 'Saved' : label}
        style={{ width: circle ? 56 : '100%' }}
        className={cx(
          'state press t-title-md relative flex h-14 items-center justify-center rounded-full bg-primary text-on-primary',
          'transition-[width,opacity,transform] duration-300 ease-emphasized',
          'disabled:cursor-not-allowed disabled:opacity-40 disabled:active:scale-100',
        )}
      >
        <span className={cx('absolute whitespace-nowrap transition-opacity duration-150', circle ? 'opacity-0' : 'opacity-100')}>{label}</span>
        {phase === 'saving' && <Spinner size={24} />}
        {phase === 'done' && (
          <>
            <svg key="check" width="28" height="28" viewBox="0 0 24 24" fill="none" aria-hidden>
              <path className="check-draw" d="M5 12.5l4.5 4.5L19 7.5" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <span aria-hidden className="ring-out pointer-events-none absolute inset-0 rounded-full border-2 border-primary" />
          </>
        )}
      </button>
      <span className="sr-only" role="status">{phase === 'done' ? 'Saved' : ''}</span>
    </div>
  );
}
