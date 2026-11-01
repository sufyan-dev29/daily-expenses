'use client';
import { animate, motion, useMotionValue, useTransform } from 'framer-motion';
import { useMemo, useRef } from 'react';
import { Icon, Skeleton, cx } from '@/components/ui';
import { useApp } from '@/components/AppProvider';
import { OptionAvatar, OptionPill } from '@/components/entry/parts';
import type { Transaction } from '@/lib/types';

function Row({ tx, onEdit, onTrash, selected, index }: { tx: Transaction; onEdit: (t: Transaction) => void; onTrash: (t: Transaction) => void; selected: boolean; index: number }) {
  const { optionById, options, money } = useApp();
  const x = useMotionValue(0);
  const bgOpacity = useTransform(x, [-120, -20, 0], [1, 0.6, 0]);
  const dragged = useRef(false);

  const isExpense = tx.kind === 'expense';
  const cat = optionById(isExpense ? tx.category_id : tx.income_source_id);
  const bank = optionById(tx.bank_id);
  const mode = optionById(tx.payment_mode_id);

  return (
    <li className="group rise relative overflow-hidden rounded-3xl" style={{ animationDelay: `${Math.min(index, 8) * 24}ms` }}>
      {/* revealed by swiping left */}
      <motion.div style={{ opacity: bgOpacity }} className="absolute inset-0 flex items-center justify-end bg-error-container pr-7 text-on-error-container" aria-hidden>
        <Icon name="delete" />
      </motion.div>
      <motion.div
        style={{ x, touchAction: 'pan-y' }}
        drag="x"
        dragDirectionLock
        dragConstraints={{ left: 0, right: 0 }}
        dragElastic={{ left: 0.6, right: 0 }}
        onDragStart={() => { dragged.current = true; }}
        onDragEnd={(_, info) => {
          if (info.offset.x < -110 || info.velocity.x < -700) {
            animate(x, -400, { duration: 0.18 }).then(() => { onTrash(tx); });
          } else {
            animate(x, 0, { type: 'spring', stiffness: 500, damping: 40 });
          }
          setTimeout(() => { dragged.current = false; }, 50);
        }}
        className={cx('relative flex min-h-[68px] items-center gap-3 bg-[var(--hist-card,var(--md-sys-color-surface-container-low))] pr-2 transition-colors duration-200', selected && '!bg-secondary-container')}
      >
        <button
          type="button"
          onClick={() => { if (!dragged.current) onEdit(tx); }}
          className="state press flex min-h-[68px] min-w-0 flex-1 items-center gap-3 rounded-3xl px-3 py-2 text-left"
          aria-label={`Edit ${tx.name}, ${money(tx.amount)}`}
        >
          <OptionAvatar option={cat} all={options} size={44} />
          <span className="min-w-0 flex-1">
            {/* name and amount share the top line, so the pills below get the full row width */}
            <span className="flex items-baseline justify-between gap-3">
              <span className="t-body-lg min-w-0 truncate font-medium">{tx.name}</span>
              <span className={cx('num t-title-md shrink-0', isExpense ? 'text-expense' : 'text-income')}>
                {isExpense ? '−' : '+'}{money(tx.amount)}
              </span>
            </span>
            <span className="mt-1.5 flex min-w-0 flex-wrap items-center gap-1">
              <OptionPill option={bank} all={options} />
              <OptionPill option={mode} all={options} />
              {!bank && !mode && <span className="t-body-md truncate text-on-surface-variant">{cat?.name ?? ' '}</span>}
              {tx.pending && <span className="inline-flex items-center gap-0.5 text-[11px] font-semibold text-tertiary"><Icon name="schedule" size={13} />pending</span>}
            </span>
          </span>
        </button>
        {/* pointer devices: explicit action (swipe is for touch) */}
        <button
          type="button"
          aria-label={`Move ${tx.name} to Trash`}
          onClick={() => onTrash(tx)}
          className="state hidden h-10 w-10 shrink-0 items-center justify-center rounded-full text-on-surface-variant opacity-0 focus:opacity-100 group-hover:opacity-100 [@media(hover:hover)]:flex"
        >
          <Icon name="delete" size={20} />
        </button>
      </motion.div>
    </li>
  );
}

export function HistoryList({
  items,
  loading,
  editingId,
  onEdit,
  onTrash,
  hasMore,
  onMore,
  empty,
}: {
  items: Transaction[];
  loading: boolean;
  editingId?: string | null;
  onEdit: (t: Transaction) => void;
  onTrash: (t: Transaction) => void;
  hasMore: boolean;
  onMore: () => void;
  empty: string;
}) {
  const { dayLabel } = useApp();
  const groups = useMemo(() => {
    const m = new Map<string, Transaction[]>();
    items.forEach((t) => m.set(t.occurred_on, [...(m.get(t.occurred_on) ?? []), t]));
    return [...m.entries()];
  }, [items]);

  if (loading && !items.length) {
    return (
      <div className="flex flex-col gap-2" aria-busy>
        {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-16" />)}
      </div>
    );
  }
  if (!items.length) {
    return (
      <div className="flex flex-col items-center gap-3 px-6 py-16 text-center">
        <div className="relative h-20 w-20" aria-hidden>
          <span className="absolute left-0 top-2 h-14 w-14 rounded-full bg-secondary-container" />
          <span className="absolute bottom-0 right-0 h-12 w-12 rounded-m3-lg bg-tertiary-container" />
        </div>
        <p className="t-body-lg text-on-surface-variant">{empty}</p>
      </div>
    );
  }
  return (
    <div>
      {groups.map(([day, list]) => (
        <section key={day} aria-label={dayLabel(day)} className="first:[&>h3]:pt-1">
          <h3 className="t-label-lg sticky top-0 z-[1] bg-[var(--hist-bg,var(--md-sys-color-surface-container-low))] px-3 pb-2 pt-4 text-on-surface-variant">{dayLabel(day)}</h3>
          <ul className="flex flex-col gap-2 pb-1">
            {list.map((t, i) => <Row key={t.id} tx={t} onEdit={onEdit} onTrash={onTrash} selected={editingId === t.id} index={i} />)}
          </ul>
        </section>
      ))}
      {hasMore && (
        <button className="state press t-label-lg mx-auto mt-4 block min-h-[48px] rounded-full bg-secondary-container px-6 text-on-secondary-container" onClick={onMore}>
          Load more
        </button>
      )}
    </div>
  );
}
