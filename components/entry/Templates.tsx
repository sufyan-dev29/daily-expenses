'use client';
import { useRef, useState } from 'react';
import { Button, Chip, Field, Icon, Segmented, Sheet, Switch, cx, useSnackbar } from '@/components/ui';
import { useApp } from '@/components/AppProvider';
import { localDb } from '@/lib/local/client';
import { newId, parseAmount } from '@/lib/format';
import { saveTx } from '@/lib/tx';
import type { Kind, Template, Transaction } from '@/lib/types';

/** Chips above the form. Tap = apply; long-press = manage. */
export function TemplatesStrip({
  kind,
  onApply,
  onAddedInstant,
}: {
  kind: Kind;
  onApply: (t: Template) => void;
  onAddedInstant: (tx: Transaction) => void;
}) {
  const { templates, refreshTemplates, today, money } = useApp();
  const snack = useSnackbar();
  const [manage, setManage] = useState<Template | null>(null);
  const [bundle, setBundle] = useState(false);
  const list = templates.filter((t) => t.kind === kind);
  const pressTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const longPressed = useRef(false);

  const tap = async (t: Template) => {
    if (longPressed.current) { longPressed.current = false; return; }
    const p = t.payload;
    if (t.behavior === 'instant' && p.name && p.amount && p.amount > 0) {
      const input = {
        id: newId(),
        kind,
        name: p.name,
        amount: p.amount,
        occurred_on: today(),
        category_id: p.category_id ?? null,
        bank_id: p.bank_id ?? null,
        payment_mode_id: p.payment_mode_id ?? null,
        income_source_id: p.income_source_id ?? null,
        need_want: p.need_want ?? null,
        notes: p.notes ?? null,
      };
      const r = await saveTx(input);
      if (r.error) return snack({ message: r.error });
      onAddedInstant({ ...input, deleted_at: null, created_at: new Date().toISOString(), pending: r.pending });
      snack({ message: `Added ${p.name}` });
      try { navigator.vibrate?.(20); } catch {}
    } else onApply(t);
  };

  const down = (t: Template) => {
    longPressed.current = false;
    pressTimer.current = setTimeout(() => { longPressed.current = true; setManage(t); }, 500);
  };
  const up = () => clearTimeout(pressTimer.current);

  const toggleBehavior = async (t: Template) => {
    await localDb().from('templates').update({ behavior: t.behavior === 'fill' ? 'instant' : 'fill' }).eq('id', t.id);
    await refreshTemplates();
    setManage(null);
  };
  const remove = async (t: Template) => {
    await localDb().from('templates').delete().eq('id', t.id);
    await refreshTemplates();
    setManage(null);
  };

  if (!list.length) return null;
  return (
    <>
      <div className="no-scrollbar -mx-4 mb-4 flex gap-2 overflow-x-auto px-4 medium:-mx-6 medium:px-6" role="list" aria-label="Templates">
        {kind === 'expense' && list.length > 1 && (
          <Chip icon="playlist_add_check" onClick={() => setBundle(true)}>Monthly bundle</Chip>
        )}
        {list.map((t) => (
          <span key={t.id} role="listitem" onPointerDown={() => down(t)} onPointerUp={up} onPointerLeave={up} onPointerCancel={up} onContextMenu={(e) => { e.preventDefault(); setManage(t); }}>
            <Chip icon={t.behavior === 'instant' ? 'bolt' : undefined} onClick={() => tap(t)}>{t.name}</Chip>
          </span>
        ))}
      </div>

      <Sheet open={!!manage} onClose={() => setManage(null)} title={manage?.name ?? ''}>
        {manage && (
          <div className="flex flex-col gap-1 px-2 pb-4">
            <button className="state t-body-lg flex min-h-[56px] items-center gap-3 rounded-full px-4 text-left" onClick={() => toggleBehavior(manage)}>
              <Icon name={manage.behavior === 'fill' ? 'bolt' : 'edit_note'} />
              {manage.behavior === 'fill' ? 'Make it one-tap (adds instantly)' : 'Make it fill the form (review first)'}
            </button>
            <button className="state t-body-lg flex min-h-[56px] items-center gap-3 rounded-full px-4 text-left text-error" onClick={() => remove(manage)}>
              <Icon name="delete" /> Delete template
            </button>
          </div>
        )}
      </Sheet>

      <BundleSheet open={bundle} onClose={() => setBundle(false)} templates={list} money={money} onAdded={(txs) => txs.forEach(onAddedInstant)} />
    </>
  );
}

/** Add several recurring templates at once, with an editable checklist. */
function BundleSheet({
  open,
  onClose,
  templates,
  money,
  onAdded,
}: {
  open: boolean;
  onClose: () => void;
  templates: Template[];
  money: (n: number) => string;
  onAdded: (txs: Transaction[]) => void;
}) {
  const { today } = useApp();
  const snack = useSnackbar();
  const [checked, setChecked] = useState<Record<string, boolean>>({});
  const [amounts, setAmounts] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  const isOn = (t: Template) => checked[t.id] ?? !!(t.payload.amount && t.payload.amount > 0);
  const amt = (t: Template) => parseAmount(amounts[t.id] ?? String(t.payload.amount ?? ''));
  const chosen = templates.filter((t) => isOn(t) && amt(t) > 0);
  const total = chosen.reduce((s, t) => s + amt(t), 0);

  const add = async () => {
    setBusy(true);
    const out: Transaction[] = [];
    for (const t of chosen) {
      const p = t.payload;
      const input = {
        id: newId(),
        kind: 'expense' as const,
        name: p.name ?? t.name,
        amount: amt(t),
        occurred_on: today(),
        category_id: p.category_id ?? null,
        bank_id: p.bank_id ?? null,
        payment_mode_id: p.payment_mode_id ?? null,
        income_source_id: null,
        need_want: p.need_want ?? null,
        notes: p.notes ?? null,
      };
      const r = await saveTx(input);
      if (!r.error) out.push({ ...input, deleted_at: null, created_at: new Date().toISOString(), pending: r.pending });
    }
    setBusy(false);
    onAdded(out);
    onClose();
    snack({ message: `Added ${out.length} ${out.length === 1 ? 'entry' : 'entries'}` });
  };

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Monthly bundle"
      footer={
        <Button className="h-14 w-full" disabled={!chosen.length || busy} onClick={add}>
          Add {chosen.length} · {money(total)}
        </Button>
      }
    >
      <ul className="px-2">
        {templates.map((t) => (
          <li key={t.id} className="flex min-h-[56px] items-center gap-3 px-3">
            <input type="checkbox" aria-label={`Include ${t.name}`} className="h-5 w-5 accent-[var(--md-sys-color-primary)]" checked={isOn(t)} onChange={(e) => setChecked({ ...checked, [t.id]: e.target.checked })} />
            <span className="t-body-lg flex-1">{t.name}</span>
            <input
              inputMode="decimal"
              aria-label={`Amount for ${t.name}`}
              className="num t-body-lg h-10 w-28 rounded-m3-sm border border-outline bg-transparent px-2 text-right"
              value={amounts[t.id] ?? (t.payload.amount ? String(t.payload.amount) : '')}
              placeholder="0"
              onChange={(e) => setAmounts({ ...amounts, [t.id]: e.target.value })}
            />
          </li>
        ))}
      </ul>
    </Sheet>
  );
}

/** "Save as template" sheet, opened from the form. */
export function SaveTemplateSheet({
  open,
  onClose,
  kind,
  defaults,
}: {
  open: boolean;
  onClose: () => void;
  kind: Kind;
  defaults: Template['payload'];
}) {
  const { refreshTemplates, templates } = useApp();
  const snack = useSnackbar();
  const [name, setName] = useState('');
  const [behavior, setBehavior] = useState<'fill' | 'instant'>('fill');
  const [withAmount, setWithAmount] = useState(true);

  const save = async () => {
    const payload = { ...defaults, amount: withAmount ? defaults.amount ?? null : null };
    const { error } = await localDb().from('templates').insert({
      kind,
      name: name.trim() || defaults.name || 'Template',
      behavior: behavior === 'instant' && !(payload.amount && payload.amount > 0) ? 'fill' : behavior,
      payload,
      sort_order: templates.filter((t) => t.kind === kind).length,
    });
    if (error) return snack({ message: error.message });
    await refreshTemplates();
    onClose();
    snack({ message: 'Template saved' });
  };

  return (
    <Sheet open={open} onClose={onClose} title="Save as template" footer={<Button className="h-14 w-full" onClick={save}>Save template</Button>}>
      <div className="flex flex-col gap-4 px-4 pb-2">
        <Field label="Template name" value={name} placeholder={defaults.name ?? ''} onChange={(e) => setName(e.target.value)} data-autofocus />
        <Segmented
          label="Behaviour"
          value={behavior}
          onChange={setBehavior}
          options={[{ value: 'fill', label: 'Fill form' }, { value: 'instant', label: 'One tap' }]}
        />
        <div className="flex items-center justify-between">
          <span className="t-body-lg">Include amount</span>
          <Switch checked={withAmount} onChange={setWithAmount} label="Include amount" />
        </div>
        <p className="t-body-md text-on-surface-variant">
          {behavior === 'instant' ? 'One tap adds the entry straight away, dated today. It needs a name and an amount.' : 'Fill form puts the values in the form so you can review before adding.'}
        </p>
      </div>
    </Sheet>
  );
}
