'use client';
import { useEffect, useRef } from 'react';
import { Icon, cx } from '@/components/ui';
import { ICON_CHOICES } from '@/lib/seed';

/** Scrolling row of icons. `data-no-swipe` keeps the sheet's swipe-down from stealing sideways drags. */
export function IconRow({ value, onChange }: { value: string; onChange: (icon: string) => void }) {
  const list = ICON_CHOICES.includes(value) ? ICON_CHOICES : [value, ...ICON_CHOICES];
  const box = useRef<HTMLDivElement>(null);
  // keep the chosen icon in view (scrolls the row only, never the page or the sheet)
  useEffect(() => {
    const el = box.current?.querySelector<HTMLElement>('[aria-selected=true]');
    if (box.current && el) box.current.scrollTo({ left: el.offsetLeft - box.current.clientWidth / 2 + el.clientWidth / 2, behavior: 'smooth' });
  }, [value]);
  return (
    <div ref={box} data-no-swipe className="no-scrollbar -mx-4 flex gap-1.5 overflow-x-auto px-4 pb-1" role="listbox" aria-label="Icon">
      {list.map((i) => (
        <button
          key={i}
          type="button"
          role="option"
          aria-selected={value === i}
          aria-label={i.replace(/_/g, ' ')}
          onClick={() => onChange(i)}
          className={cx('state press flex h-11 w-11 shrink-0 items-center justify-center rounded-full', value === i ? 'bg-secondary-container text-on-secondary-container pop' : 'bg-surface-container-high text-on-surface-variant')}
        >
          <Icon name={i} fill={value === i} />
        </button>
      ))}
    </div>
  );
}

/** "Auto" plus the eight option colours. '' means automatic. */
export function ColorRow({ value, onChange }: { value: string; onChange: (c: string) => void }) {
  return (
    <div data-no-swipe className="no-scrollbar -mx-4 flex items-center gap-2 overflow-x-auto px-4 pb-1" role="listbox" aria-label="Colour">
      <button type="button" aria-selected={!value} onClick={() => onChange('')} className={cx('t-label-lg state press h-10 shrink-0 rounded-full px-4', !value ? 'bg-secondary-container text-on-secondary-container' : 'bg-surface-container-high')}>Auto</button>
      {[1, 2, 3, 4, 5, 6, 7, 8].map((n) => (
        <button
          key={n}
          type="button"
          aria-label={`Colour ${n}`}
          aria-selected={value === String(n)}
          onClick={() => onChange(String(n))}
          className={cx('press h-10 w-10 shrink-0 rounded-full border-2', value === String(n) ? 'border-on-surface' : 'border-transparent')}
          style={{ background: `var(--cat-${n})` }}
        />
      ))}
    </div>
  );
}
