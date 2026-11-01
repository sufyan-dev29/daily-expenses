'use client';
import { useState } from 'react';
import { Field, Icon, IconButton, Section, Segmented, Sheet, Button, useSnackbar } from '@/components/ui';
import { useApp } from '@/components/AppProvider';
import { supabaseBrowser } from '@/lib/supabase/browser';
import type { Template } from '@/lib/types';

export function TemplatesSection() {
  const { templates, refreshTemplates, money } = useApp();
  const snack = useSnackbar();
  const [edit, setEdit] = useState<Template | null>(null);
  const sb = supabaseBrowser();

  const move = async (t: Template, dir: -1 | 1) => {
    const same = templates.filter((x) => x.kind === t.kind);
    const i = same.findIndex((x) => x.id === t.id);
    const o = same[i + dir];
    if (!o) return;
    const order = same.map((x) => x.id);
    order.splice(i, 1);
    order.splice(i + dir, 0, t.id);
    await Promise.all(order.map((id, idx) => sb.from('templates').update({ sort_order: idx }).eq('id', id)));
    refreshTemplates();
  };

  return (
    <Section title="Templates" description="Quick chips on the Add screens. Create one with “Save as template” in the form.">
      {(['expense', 'income'] as const).map((k) => {
        const list = templates.filter((t) => t.kind === k);
        return (
          <div key={k} className="mb-2">
            <h3 className="t-label-lg mb-1 text-on-surface-variant">{k === 'expense' ? 'Expense' : 'Income'}</h3>
            {!list.length && <p className="t-body-md pb-2 text-on-surface-variant">None yet.</p>}
            {list.map((t, i) => (
              <div key={t.id} className="flex min-h-[56px] items-center gap-1 border-b border-outline-variant/40">
                <button className="min-h-[48px] min-w-0 flex-1 text-left" onClick={() => setEdit(t)}>
                  <span className="t-body-lg block truncate">{t.name}</span>
                  <span className="t-body-md block text-on-surface-variant">{t.behavior === 'instant' ? 'One tap' : 'Fills form'}{t.payload.amount ? ` · ${money(t.payload.amount)}` : ''}</span>
                </button>
                <IconButton icon="arrow_upward" label={`Move ${t.name} up`} disabled={i === 0} onClick={() => move(t, -1)} />
                <IconButton icon="arrow_downward" label={`Move ${t.name} down`} disabled={i === list.length - 1} onClick={() => move(t, 1)} />
              </div>
            ))}
          </div>
        );
      })}

      {edit && (
        <TemplateEdit
          key={edit.id}
          t={edit}
          onClose={() => setEdit(null)}
          onSave={async (patch) => {
            const { error } = await sb.from('templates').update(patch).eq('id', edit.id);
            if (error) return snack({ message: error.message });
            setEdit(null);
            refreshTemplates();
          }}
          onDelete={async () => {
            await sb.from('templates').delete().eq('id', edit.id);
            setEdit(null);
            refreshTemplates();
          }}
        />
      )}
    </Section>
  );
}

function TemplateEdit({ t, onClose, onSave, onDelete }: { t: Template; onClose: () => void; onSave: (p: Partial<Template>) => void; onDelete: () => void }) {
  const [name, setName] = useState(t.name);
  const [behavior, setBehavior] = useState(t.behavior);
  const [amount, setAmount] = useState(t.payload.amount ? String(t.payload.amount) : '');
  return (
    <Sheet
      open
      onClose={onClose}
      title="Edit template"
      footer={
        <div className="flex gap-2">
          <Button variant="outlined" className="flex-1 !text-error" icon="delete" onClick={onDelete}>Delete</Button>
          <Button className="flex-1" disabled={!name.trim()} onClick={() => onSave({ name: name.trim(), behavior, payload: { ...t.payload, amount: Number(amount) > 0 ? Number(amount) : null } })}>Save</Button>
        </div>
      }
    >
      <div className="flex flex-col gap-4 px-4 pb-3">
        <Field label="Name" value={name} onChange={(e) => setName(e.target.value)} data-autofocus />
        <Field label="Amount (optional)" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ''))} />
        <Segmented label="Behaviour" value={behavior} onChange={setBehavior} options={[{ value: 'fill', label: 'Fill form' }, { value: 'instant', label: 'One tap' }]} />
        <p className="t-body-md text-on-surface-variant"><Icon name="info" size={16} className="mr-1 align-text-bottom" />One tap needs a name and an amount.</p>
      </div>
    </Sheet>
  );
}
