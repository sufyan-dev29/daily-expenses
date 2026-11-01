'use client';
import { useState } from 'react';
import { Button, Field, Icon, IconButton, Section, Sheet, cx, useSnackbar } from '@/components/ui';
import { useApp } from '@/components/AppProvider';
import { supabaseBrowser } from '@/lib/supabase/browser';
import { ICON_CHOICES, iconForOption } from '@/lib/seed';
import { OptionAvatar, optionLook } from '@/components/entry/parts';
import type { Option, OptionKind } from '@/lib/types';

const KINDS: { kind: OptionKind; title: string; icon: string; description: string }[] = [
  { kind: 'category', title: 'Categories', icon: 'category', description: 'What an expense was for.' },
  { kind: 'bank', title: 'Banks and wallets', icon: 'account_balance', description: 'The account money moves through.' },
  { kind: 'payment_mode', title: 'Payment modes', icon: 'wallet', description: 'How you paid (card, cash, transfer…).' },
  { kind: 'income_source', title: 'Income sources', icon: 'savings', description: 'Where income comes from.' },
];


export function ListsSection() {
  return (
    <>
      {KINDS.map((k) => <OneList key={k.kind} {...k} />)}
    </>
  );
}

function OneList({ kind, title, icon, description }: { kind: OptionKind; title: string; icon: string; description: string }) {
  const { optionsOf, options, refreshOptions } = useApp();
  const snack = useSnackbar();
  const [name, setName] = useState('');
  const [edit, setEdit] = useState<Option | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const all = optionsOf(kind, true).sort((a, b) => a.sort_order - b.sort_order);
  const live = all.filter((o) => !o.archived_at);
  const archived = all.filter((o) => o.archived_at);
  const sb = supabaseBrowser();
  const hasIcon = true; // every list can have its own icon and colour

  const add = async () => {
    const n = name.trim();
    if (!n) return;
    const { error } = await sb.from('options').insert({ kind, name: n, sort_order: all.length, icon: iconForOption(kind, n, null) });
    if (error) return snack({ message: error.code === '23505' ? 'That name already exists.' : error.message });
    setName('');
    refreshOptions();
  };

  const move = async (o: Option, dir: -1 | 1) => {
    const i = live.findIndex((x) => x.id === o.id);
    const other = live[i + dir];
    if (!other) return;
    await Promise.all([sb.from('options').update({ sort_order: other.sort_order }).eq('id', o.id), sb.from('options').update({ sort_order: o.sort_order }).eq('id', other.id)]);
    // equal sort_orders would not swap: normalise
    if (other.sort_order === o.sort_order) await Promise.all(live.map((x, idx) => sb.from('options').update({ sort_order: idx + (x.id === o.id ? dir : x.id === other.id ? -dir : 0) }).eq('id', x.id)));
    refreshOptions();
  };

  const save = async (patch: Partial<Option>) => {
    if (!edit) return;
    const { error } = await sb.from('options').update(patch).eq('id', edit.id);
    if (error) return snack({ message: error.code === '23505' ? 'That name already exists.' : error.message });
    setEdit(null);
    refreshOptions();
  };

  return (
    <Section title={title} icon={icon} description={description}>
      <ul>
        {live.map((o, i) => (
          <li key={o.id} className="rise flex min-h-[60px] items-center gap-1 border-b border-outline-variant/40 last:border-0">
            <OptionAvatar option={o} all={options} size={36} className="mr-2" />
            <button className="t-body-lg min-h-[48px] flex-1 truncate text-left" onClick={() => setEdit(o)}>{o.name}</button>
            <IconButton icon="arrow_upward" label={`Move ${o.name} up`} disabled={i === 0} onClick={() => move(o, -1)} />
            <IconButton icon="arrow_downward" label={`Move ${o.name} down`} disabled={i === live.length - 1} onClick={() => move(o, 1)} />
            <IconButton icon="edit" label={`Edit ${o.name}`} onClick={() => setEdit(o)} />
          </li>
        ))}
        {!live.length && <li className="t-body-md py-3 text-on-surface-variant">Nothing here yet.</li>}
      </ul>
      <div className="mt-3 flex items-start gap-2">
        <Field className="flex-1" label={`Add to ${title.toLowerCase()}`} value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && add()} />
        <Button className="mt-6" onClick={add} disabled={!name.trim()}>Add</Button>
      </div>
      {archived.length > 0 && (
        <div className="mt-3">
          <button className="t-label-lg flex min-h-[48px] items-center gap-1 text-primary" onClick={() => setShowArchived((v) => !v)} aria-expanded={showArchived}>
            <Icon name={showArchived ? 'expand_less' : 'expand_more'} size={18} /> Archived ({archived.length})
          </button>
          {showArchived && archived.map((o) => (
            <div key={o.id} className="flex min-h-[48px] items-center justify-between text-on-surface-variant">
              <span className="t-body-lg">{o.name}</span>
              <Button variant="text" onClick={async () => { await sb.from('options').update({ archived_at: null }).eq('id', o.id); refreshOptions(); }}>Restore</Button>
            </div>
          ))}
        </div>
      )}

      <EditSheet key={edit?.id ?? 'none'} opt={edit} hasIcon={hasIcon} onClose={() => setEdit(null)} onSave={save} />
    </Section>
  );
}

function EditSheet({ opt, hasIcon, onClose, onSave }: { opt: Option | null; hasIcon: boolean; onClose: () => void; onSave: (p: Partial<Option>) => void }) {
  const [name, setName] = useState(opt?.name ?? '');
  const [icon, setIcon] = useState(opt?.icon ?? iconForOption(opt?.kind ?? 'category', opt?.name ?? '', null));
  const [color, setColor] = useState(opt?.color ?? '');
  if (!opt) return <Sheet open={false} onClose={onClose} title="Edit">{null}</Sheet>;
  return (
    <Sheet
      open
      onClose={onClose}
      title={`Edit ${opt.name}`}
      footer={
        <div className="flex gap-2">
          <Button variant="outlined" className="flex-1" onClick={() => onSave({ archived_at: new Date().toISOString() })}>Archive</Button>
          <Button className="flex-1" disabled={!name.trim()} onClick={() => onSave({ name: name.trim(), ...(hasIcon ? { icon, color: color || null } : {}) })}>Save</Button>
        </div>
      }
    >
      <div className="flex flex-col gap-4 px-4 pb-3">
        <Field label="Name" value={name} onChange={(e) => setName(e.target.value)} data-autofocus />
        {hasIcon && (
          <>
            <div>
              <div className="t-label-md mb-2 text-on-surface-variant">Icon</div>
              <div className="grid grid-cols-6 gap-2 medium:grid-cols-8">
                {ICON_CHOICES.map((i) => (
                  <button key={i} type="button" aria-label={i.replace(/_/g, ' ')} aria-pressed={icon === i} onClick={() => setIcon(i)} className={cx('state flex h-12 w-12 items-center justify-center rounded-full', icon === i ? 'bg-secondary-container text-on-secondary-container' : 'text-on-surface-variant')}>
                    <Icon name={i} />
                  </button>
                ))}
              </div>
            </div>
            <div>
              <div className="t-label-md mb-2 text-on-surface-variant">Colour</div>
              <div className="flex flex-wrap gap-2">
                <button type="button" aria-pressed={!color} onClick={() => setColor('')} className={cx('t-label-lg h-10 rounded-full px-4', !color ? 'bg-secondary-container text-on-secondary-container' : 'bg-surface-container-high')}>Auto</button>
                {[1, 2, 3, 4, 5, 6, 7, 8].map((n) => (
                  <button key={n} type="button" aria-label={`Colour ${n}`} aria-pressed={color === String(n)} onClick={() => setColor(String(n))} className={cx('h-10 w-10 rounded-full border-2', color === String(n) ? 'border-on-surface' : 'border-transparent')} style={{ background: `var(--cat-${n})` }} />
                ))}
              </div>
            </div>
          </>
        )}
        <p className="t-body-md text-on-surface-variant">Archiving hides it from pickers but keeps it on past entries.</p>
      </div>
    </Sheet>
  );
}
