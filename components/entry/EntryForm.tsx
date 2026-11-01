'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button, Icon, Segmented, cx, useSnackbar } from '@/components/ui';
import { useApp } from '@/components/AppProvider';
import { AmountPad, DateSheet, SelectSheet, SuccessButton, Token } from '@/components/entry/parts';
import { SaveTemplateSheet, TemplatesStrip } from '@/components/entry/Templates';
import { supabaseBrowser } from '@/lib/supabase/browser';
import { currencySymbol, newId, parseAmount } from '@/lib/format';
import { saveTx, TX_COLUMNS } from '@/lib/tx';
import { iconForOption } from '@/lib/seed';
import type { Kind, NeedWant, OptionKind, Template, Transaction } from '@/lib/types';

interface FormState {
  name: string;
  amount: string;
  date: string;
  category_id: string | null;
  bank_id: string | null;
  payment_mode_id: string | null;
  income_source_id: string | null;
  need_want: NeedWant | null;
  notes: string;
}

type Remembered = Pick<FormState, 'category_id' | 'bank_id' | 'payment_mode_id' | 'income_source_id' | 'need_want'>;
type Picker = null | 'amount' | 'bank' | 'mode' | 'category' | 'source' | 'date';

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex min-h-[56px] items-center justify-between gap-3">
      <span className="t-label-lg shrink-0 text-on-surface-variant">{label}</span>
      <div className="flex min-w-0 max-w-[68%] justify-end">{children}</div>
    </div>
  );
}

export function EntryForm({
  kind,
  editing,
  onCancelEdit,
  onSaved,
  onTrashEditing,
}: {
  kind: Kind;
  editing: Transaction | null;
  onCancelEdit: () => void;
  onSaved: (tx: Transaction, wasEdit: boolean) => void;
  onTrashEditing: (tx: Transaction) => void;
}) {
  const { settings, options, optionsOf, optionName, optionById, refreshOptions, today, templates } = useApp();
  const snack = useSnackbar();
  const isExpense = kind === 'expense';

  const blank = useCallback(
    (r: Remembered | null): FormState => ({
      name: '',
      amount: '',
      date: today(),
      category_id: r?.category_id ?? null,
      bank_id: r?.bank_id ?? null,
      payment_mode_id: r?.payment_mode_id ?? null,
      income_source_id: r?.income_source_id ?? null,
      need_want: r?.need_want ?? null,
      notes: '',
    }),
    [today],
  );

  const remembered = useRef<Remembered | null>(null);
  const [f, setF] = useState<FormState>(() => blank(null));
  const [picker, setPicker] = useState<Picker>(null);
  const [saveTpl, setSaveTpl] = useState(false);
  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setF((s) => ({ ...s, [k]: v }));

  /** Defaults from the most recent entry of this kind, respecting the per-field toggles and archived options. */
  const computeRemembered = useCallback(
    (last: Partial<Transaction> | null): Remembered => {
      const rl = settings.remember_last;
      const live = (id: string | null | undefined, k: OptionKind) => {
        const o = optionById(id);
        return o && !o.archived_at && o.kind === k ? o.id : null;
      };
      return {
        category_id: rl.category && isExpense ? live(last?.category_id, 'category') : null,
        bank_id: rl.bank ? live(last?.bank_id, 'bank') : null,
        payment_mode_id: rl.payment_mode ? live(last?.payment_mode_id, 'payment_mode') : null,
        income_source_id: rl.income_source && !isExpense ? live(last?.income_source_id, 'income_source') : null,
        need_want: rl.need_want && isExpense ? last?.need_want ?? null : null,
      };
    },
    [settings.remember_last, optionById, isExpense],
  );

  // load the last entry once per kind
  useEffect(() => {
    let alive = true;
    (async () => {
      const { data } = await supabaseBrowser()
        .from('transactions')
        .select(TX_COLUMNS)
        .eq('kind', kind)
        .is('deleted_at', null)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (!alive) return;
      remembered.current = computeRemembered((data as Transaction | null) ?? null);
      if (!editing) setF((s) => ({ ...blank(remembered.current), name: s.name, amount: s.amount, notes: s.notes, date: s.date }));
    })();
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind]);

  // entering / leaving edit mode
  useEffect(() => {
    if (editing) {
      setF({
        name: editing.name,
        amount: String(editing.amount),
        date: editing.occurred_on,
        category_id: editing.category_id,
        bank_id: editing.bank_id,
        payment_mode_id: editing.payment_mode_id,
        income_source_id: editing.income_source_id,
        need_want: editing.need_want,
        notes: editing.notes ?? '',
      });
    } else {
      setF(blank(remembered.current));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing?.id]);

  const amountNum = parseAmount(f.amount);
  const valid = amountNum > 0 && f.name.trim().length > 0;

  const submit = async (): Promise<boolean> => {
    if (!valid) return false;
    const tx = {
      id: editing?.id ?? newId(),
      kind,
      name: f.name.trim(),
      amount: amountNum,
      occurred_on: f.date,
      category_id: isExpense ? f.category_id : null,
      bank_id: f.bank_id,
      payment_mode_id: f.payment_mode_id,
      income_source_id: isExpense ? null : f.income_source_id,
      need_want: isExpense ? f.need_want : null,
      notes: f.notes.trim() || null,
    };
    const r = await saveTx(tx);
    if (r.error) {
      snack({ message: r.error });
      return false;
    }
    const full: Transaction = { ...tx, deleted_at: null, created_at: editing?.created_at ?? new Date().toISOString(), pending: r.pending };
    onSaved(full, !!editing);
    if (!editing) {
      // only NEW entries change the remembered defaults
      remembered.current = computeRemembered(full);
    }
    // reset after the success animation has started
    setTimeout(() => {
      if (editing) onCancelEdit();
      else setF(blank(remembered.current));
    }, 450);
    return true;
  };

  const applyTemplate = (t: Template) => {
    const p = t.payload;
    setF((s) => ({
      ...s,
      name: p.name ?? s.name,
      amount: p.amount ? String(p.amount) : s.amount,
      category_id: isExpense ? p.category_id ?? s.category_id : null,
      bank_id: p.bank_id ?? s.bank_id,
      payment_mode_id: p.payment_mode_id ?? s.payment_mode_id,
      income_source_id: isExpense ? null : p.income_source_id ?? s.income_source_id,
      need_want: isExpense ? p.need_want ?? s.need_want : null,
      notes: p.notes ?? s.notes,
    }));
  };

  const addOption = (k: OptionKind) => async (name: string, look?: { icon: string; color: string | null }): Promise<string | null> => {
    const sort = optionsOf(k, true).length;
    const { data, error } = await supabaseBrowser()
      .from('options')
      .insert({ kind: k, name, sort_order: sort, icon: look?.icon ?? iconForOption(k, name, null), color: look?.color ?? null })
      .select('id')
      .single();
    if (error || !data) return null;
    await refreshOptions();
    return data.id;
  };

  const sym = currencySymbol(settings.currency);
  const cta = `${editing ? 'Update' : 'Add'} ${isExpense ? 'Expense' : 'Income'}`;
  const amountSize = f.amount.length > 10 ? 34 : f.amount.length > 8 ? 42 : f.amount.length > 6 ? 50 : 58;

  const tplDefaults = useMemo(
    () => ({
      name: f.name.trim() || undefined,
      amount: amountNum > 0 ? amountNum : null,
      category_id: f.category_id,
      bank_id: f.bank_id,
      payment_mode_id: f.payment_mode_id,
      income_source_id: f.income_source_id,
      need_want: f.need_want,
      notes: f.notes || null,
    }),
    [f, amountNum],
  );

  const dateLabel = f.date === today() ? 'Today' : new Date(f.date + 'T00:00:00').toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
  const shownAmount = f.amount ? Number(f.amount.split('.')[0] || 0).toLocaleString('en-US') + (f.amount.includes('.') ? '.' + f.amount.split('.')[1] : '') : '';

  return (
    <div className="w-full">
      {!editing && <TemplatesStrip kind={kind} onApply={applyTemplate} onAddedInstant={(tx) => onSaved(tx, false)} />}
      {editing && (
        <div className="pop mb-3 flex items-center justify-between rounded-2xl bg-tertiary-container py-1.5 pl-4 pr-2 text-on-tertiary-container">
          <span className="t-label-lg inline-flex items-center gap-2"><Icon name="edit" size={18} />Editing entry</span>
          <button className="state press t-label-lg min-h-[40px] rounded-full px-4" onClick={onCancelEdit}>Cancel</button>
        </div>
      )}

      <form onSubmit={(e) => { e.preventDefault(); }} className="flex flex-col">
        {/* the amount, big */}
        <button
          type="button"
          aria-label={`Amount, ${f.amount || '0'}`}
          onClick={() => setPicker('amount')}
          className={cx(
            'state press rise w-full rounded-[28px] px-6 py-5 text-left',
            isExpense ? 'bg-expense-container text-on-expense-container' : 'bg-income-container text-on-income-container',
          )}
        >
          <span className="t-label-lg block opacity-75">{isExpense ? 'I spent' : 'I received'}</span>
          <span className="mt-1 flex items-baseline gap-2">
            <span className="t-title-lg opacity-70">{sym}</span>
            <span key={shownAmount} style={{ fontSize: amountSize, lineHeight: 1.1 }} className={cx('num tick font-semibold tracking-tight', !shownAmount && 'opacity-40')}>
              {shownAmount || '0'}
            </span>
          </span>
          <span className="t-label-md mt-2 flex items-center gap-1.5 opacity-70">
            <Icon name="dialpad" size={16} />
            {shownAmount ? 'Tap to change' : 'Tap to enter the amount'}
          </span>
        </button>

        {/* what it was */}
        <label className="rise mt-3 block" style={{ animationDelay: '40ms' }}>
          <span className="t-label-md mb-1.5 block px-1 text-on-surface-variant">{isExpense ? 'On what' : 'For what'}</span>
          <input
            aria-label={isExpense ? 'Expense name' : 'Income description'}
            value={f.name}
            onChange={(e) => set('name', e.target.value)}
            placeholder={isExpense ? 'Expense name' : 'Description'}
            maxLength={200}
            autoComplete="off"
            enterKeyHint="done"
            className="t-body-lg h-14 w-full rounded-2xl border-2 border-transparent bg-surface-container-high px-4 font-medium transition-colors duration-200 placeholder:font-normal placeholder:text-on-surface-variant/60 focus:border-primary focus:outline-none"
          />
        </label>

        {/* the details, each in its own colour */}
        <div className="rise mt-3 rounded-[28px] bg-surface-container-low px-4 py-2" style={{ animationDelay: '80ms' }}>
          {!isExpense && (
            <Row label="From">
              <Token label="Income source" empty={!f.income_source_id} option={optionById(f.income_source_id)} all={options} onClick={() => setPicker('source')}>
                {optionName(f.income_source_id) || 'Source'}
              </Token>
            </Row>
          )}
          <Row label={isExpense ? 'Paid from' : 'Deposited to'}>
            <Token label="Bank" empty={!f.bank_id} option={optionById(f.bank_id)} all={options} icon="account_balance" onClick={() => setPicker('bank')}>
              {optionName(f.bank_id) || 'Bank'}
            </Token>
          </Row>
          <Row label="Via">
            <Token label="Payment mode" empty={!f.payment_mode_id} option={optionById(f.payment_mode_id)} all={options} icon="wallet" onClick={() => setPicker('mode')}>
              {optionName(f.payment_mode_id) || 'Payment mode'}
            </Token>
          </Row>
          <Row label="Date">
            <Token label="Date" icon="calendar_today" onClick={() => setPicker('date')}>{dateLabel}</Token>
          </Row>
          {isExpense && (
            <Row label="Category">
              <Token label="Category" empty={!f.category_id} option={optionById(f.category_id)} all={options} icon="category" onClick={() => setPicker('category')}>
                {optionName(f.category_id) || 'Choose'}
              </Token>
            </Row>
          )}
        </div>

        {isExpense && (
          <Segmented
            className="rise mt-3"
            label="Need or want"
            value={f.need_want}
            onChange={(v) => set('need_want', v)}
            options={[{ value: 'need', label: 'Need', icon: 'shield' }, { value: 'want', label: 'Want', icon: 'favorite', tone: 'want' }]}
          />
        )}

        <label className="rise mt-3 block">
          <span className="t-label-md mb-1.5 block px-1 text-on-surface-variant">Notes</span>
          <textarea
            value={f.notes}
            onChange={(e) => set('notes', e.target.value)}
            rows={2}
            maxLength={2000}
            placeholder="Optional"
            className="t-body-lg w-full resize-none rounded-2xl border-2 border-transparent bg-surface-container-high px-4 py-3 transition-colors duration-200 placeholder:text-on-surface-variant/60 focus:border-primary focus:outline-none"
          />
        </label>

        <div className="sticky bottom-[calc(var(--nav-h)+env(safe-area-inset-bottom)+8px)] z-10 -mx-4 mt-4 bg-surface px-4 pb-2 pt-2 expanded:bottom-0 expanded:static expanded:mx-0 expanded:px-0 expanded:pb-0">
          <SuccessButton label={cta} disabled={!valid} onSubmit={submit} />
        </div>

        <div className="mt-2 flex items-center justify-center gap-2">
          {!editing && (
            <Button type="button" variant="text" icon="bookmark_add" disabled={!f.name.trim()} onClick={() => setSaveTpl(true)}>
              Save as template
            </Button>
          )}
          {editing && (
            <Button type="button" variant="text" icon="delete" className="!text-error" onClick={() => onTrashEditing(editing)}>
              Move to Trash
            </Button>
          )}
        </div>
      </form>

      <AmountPad open={picker === 'amount'} onClose={() => setPicker(null)} value={f.amount} onChange={(v) => set('amount', v)} prefix={sym} />
      <DateSheet open={picker === 'date'} onClose={() => setPicker(null)} value={f.date} onChange={(v) => set('date', v)} today={today()} />
      <SelectSheet open={picker === 'bank'} onClose={() => setPicker(null)} title={isExpense ? 'Paid from' : 'Deposited to'} items={optionsOf('bank')} selectedId={f.bank_id} onSelect={(id) => set('bank_id', id)} onAdd={addOption('bank')} kind="bank" allowClear />
      <SelectSheet open={picker === 'mode'} onClose={() => setPicker(null)} title="Payment mode" items={optionsOf('payment_mode')} selectedId={f.payment_mode_id} onSelect={(id) => set('payment_mode_id', id)} onAdd={addOption('payment_mode')} kind="payment_mode" allowClear />
      <SelectSheet open={picker === 'category'} onClose={() => setPicker(null)} title="Category" items={optionsOf('category')} selectedId={f.category_id} onSelect={(id) => set('category_id', id)} onAdd={addOption('category')} kind="category" allowClear />
      <SelectSheet open={picker === 'source'} onClose={() => setPicker(null)} title="Income source" items={optionsOf('income_source')} selectedId={f.income_source_id} onSelect={(id) => set('income_source_id', id)} onAdd={addOption('income_source')} kind="income_source" allowClear />
      <SaveTemplateSheet open={saveTpl} onClose={() => setSaveTpl(false)} kind={kind} defaults={tplDefaults} />
    </div>
  );
}
