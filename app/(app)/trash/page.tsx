'use client';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { Button, Icon, Sheet, Skeleton, cx, useSnackbar } from '@/components/ui';
import { useApp } from '@/components/AppProvider';
import { OptionAvatar } from '@/components/entry/parts';
import { localDb } from '@/lib/local/client';
import { deleteForever, restoreTx, TX_COLUMNS } from '@/lib/tx';
import type { Transaction } from '@/lib/types';

export default function TrashPage() {
  const { settings, optionById, options, money, dayLabel } = useApp();
  const snack = useSnackbar();
  const [items, setItems] = useState<Transaction[] | null>(null);
  const [confirm, setConfirm] = useState<Transaction | 'all' | null>(null);

  const load = useCallback(async () => {
    const { data } = await localDb().from('transactions').select(TX_COLUMNS).not('deleted_at', 'is', null).order('deleted_at', { ascending: false }).limit(500);
    setItems((data ?? []) as Transaction[]);
  }, []);
  useEffect(() => { load(); }, [load]);

  const restore = async (t: Transaction) => {
    setItems((p) => p?.filter((x) => x.id !== t.id) ?? null);
    const r = await restoreTx(t.id);
    snack({ message: r.error ?? `${t.name} restored` });
  };

  const remove = async () => {
    if (!confirm) return;
    const ids = confirm === 'all' ? (items ?? []).map((i) => i.id) : [confirm.id];
    for (const id of ids) await deleteForever(id);
    setConfirm(null);
    load();
  };

  const daysLeft = (t: Transaction & { deleted_at: string | null }) => {
    if (!t.deleted_at) return settings.trash_retention_days;
    const left = settings.trash_retention_days - Math.floor((Date.now() - new Date(t.deleted_at).getTime()) / 86_400_000);
    return Math.max(0, left);
  };

  return (
    <div className="mx-auto max-w-[720px] px-4 pb-10 expanded:px-8">
      <header className="flex h-20 items-center gap-2">
        <Link href="/expense" aria-label="Back" className="state press flex h-12 w-12 items-center justify-center rounded-full bg-surface-container-high text-on-surface-variant"><Icon name="arrow_back" /></Link>
        <h1 className="t-headline flex-1">Trash</h1>
        {!!items?.length && <Button variant="text" onClick={() => setConfirm('all')}>Empty trash</Button>}
      </header>
      <p className="t-body-md mb-3 text-on-surface-variant">Items are deleted for good after {settings.trash_retention_days} days.</p>

      {items === null ? (
        <div className="flex flex-col gap-2">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-16" />)}</div>
      ) : !items.length ? (
        <div className="flex flex-col items-center gap-3 py-20 text-center">
          <span className="flex h-20 w-20 items-center justify-center rounded-full bg-secondary-container text-on-secondary-container"><Icon name="delete" size={32} /></span>
          <p className="t-body-lg text-on-surface-variant">Trash is empty.</p>
        </div>
      ) : (
        <ul className="flex flex-col gap-1">
          {items.map((t) => {
            const isExp = t.kind === 'expense';
            const cat = optionById(isExp ? t.category_id : t.income_source_id);
            return (
              <li key={t.id} className="rise flex min-h-[68px] items-center gap-3 rounded-3xl bg-surface-container-low px-3">
                <OptionAvatar option={cat} all={options} size={44} />
                <span className="min-w-0 flex-1">
                  <span className="t-body-lg block truncate">{t.name}</span>
                  <span className="t-body-md block truncate text-on-surface-variant">{dayLabel(t.occurred_on)} · {daysLeft(t)} days left</span>
                </span>
                <span className={cx('num t-title-md', isExp ? 'text-expense' : 'text-income')}>{money(t.amount)}</span>
                <button aria-label={`Restore ${t.name}`} className="state flex h-12 w-12 items-center justify-center rounded-full text-primary" onClick={() => restore(t)}><Icon name="restore_from_trash" /></button>
                <button aria-label={`Delete ${t.name} forever`} className="state flex h-12 w-12 items-center justify-center rounded-full text-error" onClick={() => setConfirm(t)}><Icon name="delete_forever" /></button>
              </li>
            );
          })}
        </ul>
      )}

      <Sheet
        open={!!confirm}
        onClose={() => setConfirm(null)}
        title={confirm === 'all' ? 'Empty trash?' : 'Delete forever?'}
        footer={<div className="flex gap-2"><Button variant="outlined" className="flex-1" onClick={() => setConfirm(null)}>Cancel</Button><Button variant="danger" className="flex-1" onClick={remove}>Delete forever</Button></div>}
      >
        <p className="t-body-lg px-6 pb-4 text-on-surface-variant">This cannot be undone.</p>
      </Sheet>
    </div>
  );
}
