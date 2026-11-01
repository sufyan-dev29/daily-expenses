'use client';
import Link from 'next/link';
import { AnimatePresence, motion } from 'framer-motion';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Icon, useDebounced, useSnackbar, useSwipeDismiss } from '@/components/ui';
import { useApp } from '@/components/AppProvider';
import { EntryForm } from '@/components/entry/EntryForm';
import { HistoryList } from '@/components/entry/History';
import { usePending } from '@/components/AppShell';
import { localDb } from '@/lib/local/client';
import { restoreTx, trashTx, TX_COLUMNS } from '@/lib/tx';
import { pendingIds } from '@/lib/offline';
import type { Kind, Transaction } from '@/lib/types';

const PAGE = 50;

export function EntryScreen({ kind }: { kind: Kind }) {
  const { settings } = useApp();
  const snack = useSnackbar();
  const [items, setItems] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [hasMore, setHasMore] = useState(false);
  const [q, setQ] = useState('');
  const dq = useDebounced(q, 300);
  const [editing, setEditing] = useState<Transaction | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const pending = usePending();
  const page = useRef(0);
  const closeHistory = useCallback(() => setHistoryOpen(false), []);
  const swipeHistory = useSwipeDismiss(closeHistory);
  const [pull, setPull] = useState(0); // 0..1 progress of the pull-down-for-history gesture

  // Pull down from the top of the page to open History. The browser's own pull-to-refresh is disabled in CSS,
  // so this is the only thing a downward drag at the top of the page does.
  useEffect(() => {
    const THRESH = 90;
    let startY = 0, startX = 0, mode: 'idle' | 'maybe' | 'pull' | 'ignore' = 'idle', dy = 0;
    const atTop = () => (document.scrollingElement?.scrollTop ?? window.scrollY) <= 0;
    const onStart = (e: TouchEvent) => {
      const t = e.target as HTMLElement;
      if (e.touches.length !== 1 || !atTop() || window.matchMedia('(min-width: 1024px)').matches || document.body.style.overflow === 'hidden' || t.closest('input, textarea, select, .scroller, [data-no-swipe], [role=dialog]')) { mode = 'ignore'; return; }
      mode = 'maybe'; startY = e.touches[0].clientY; startX = e.touches[0].clientX; dy = 0;
    };
    const onMove = (e: TouchEvent) => {
      if (mode === 'idle' || mode === 'ignore') return;
      const y = e.touches[0].clientY, x = e.touches[0].clientX;
      if (mode === 'maybe') {
        const d = y - startY;
        if (Math.abs(d) < 8 && Math.abs(x - startX) < 8) return;
        if (d > 0 && d > Math.abs(x - startX) && atTop()) mode = 'pull'; else { mode = 'ignore'; return; }
      }
      e.preventDefault();
      dy = Math.max(0, y - startY);
      setPull(Math.min(1, dy / THRESH));
    };
    const onEnd = () => {
      if (mode === 'pull' && dy >= THRESH) setHistoryOpen(true);
      mode = 'idle'; dy = 0; setPull(0);
    };
    document.addEventListener('touchstart', onStart, { passive: true });
    document.addEventListener('touchmove', onMove, { passive: false });
    document.addEventListener('touchend', onEnd);
    document.addEventListener('touchcancel', onEnd);
    return () => {
      document.removeEventListener('touchstart', onStart);
      document.removeEventListener('touchmove', onMove);
      document.removeEventListener('touchend', onEnd);
      document.removeEventListener('touchcancel', onEnd);
    };
  }, []);

  const load = useCallback(
    async (reset: boolean) => {
      if (reset) { page.current = 0; setLoading(true); }
      let query = localDb()
        .from('transactions')
        .select(TX_COLUMNS)
        .eq('kind', kind)
        .is('deleted_at', null)
        .order('occurred_on', { ascending: false })
        .order('created_at', { ascending: false })
        .range(page.current * PAGE, page.current * PAGE + PAGE - 1);
      if (dq.trim()) query = query.ilike('name', `%${dq.trim().replace(/[%_]/g, '')}%`);
      const { data, error } = await query;
      if (error) { setLoading(false); return; }
      const rows = (data ?? []) as Transaction[];
      const p = await pendingIds().catch(() => new Set<string>());
      const marked = rows.map((r) => ({ ...r, pending: p.has(r.id) }));
      setItems((prev) => (reset ? marked : [...prev, ...marked]));
      setHasMore(rows.length === PAGE);
      setLoading(false);
    },
    [kind, dq],
  );

  useEffect(() => { load(true); }, [load, pending === 0]);

  const onSaved = (tx: Transaction, wasEdit: boolean) => {
    setItems((prev) => {
      const without = prev.filter((t) => t.id !== tx.id);
      const next = [tx, ...without];
      return next.sort((a, b) => (a.occurred_on === b.occurred_on ? b.created_at.localeCompare(a.created_at) : b.occurred_on.localeCompare(a.occurred_on)));
    });
    if (wasEdit) setHistoryOpen(false);
  };

  const onTrash = async (tx: Transaction) => {
    setItems((prev) => prev.filter((t) => t.id !== tx.id));
    if (editing?.id === tx.id) setEditing(null);
    const r = await trashTx(tx.id);
    if (r.error) {
      setItems((prev) => [tx, ...prev]);
      return snack({ message: r.error });
    }
    snack({
      message: `${tx.name} moved to Trash`,
      actionLabel: 'Undo',
      onAction: async () => {
        await restoreTx(tx.id);
        setItems((prev) => [tx, ...prev].sort((a, b) => b.occurred_on.localeCompare(a.occurred_on) || b.created_at.localeCompare(a.created_at)));
      },
    });
  };

  const onEdit = (t: Transaction) => {
    setEditing(t);
    setHistoryOpen(false);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const title = kind === 'expense' ? 'Add expense' : 'Add income';
  const searchBox = (
    <label className="relative block">
      <span className="sr-only">Search history</span>
      <Icon name="search" className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-on-surface-variant" />
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Search"
        className="t-body-lg h-12 w-full rounded-full border-2 border-transparent bg-surface-container-high pl-12 pr-4 transition-colors duration-200 focus:border-primary focus:outline-none"
      />
    </label>
  );

  const list = (
    <HistoryList
      items={items}
      loading={loading}
      editingId={editing?.id}
      onEdit={onEdit}
      onTrash={onTrash}
      hasMore={hasMore}
      onMore={() => { page.current += 1; load(false); }}
      empty={q ? 'Nothing matches that search.' : kind === 'expense' ? 'No expenses yet. Add your first one above.' : 'No income yet.'}
    />
  );

  // keyboard shortcuts (desktop): N = focus a new entry, / = search
  useEffect(() => {
    const f = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (/input|textarea|select/i.test(t.tagName) || e.metaKey || e.ctrlKey) return;
      if (e.key === 'n') { e.preventDefault(); setEditing(null); document.querySelector<HTMLInputElement>('input[aria-label$="name"], input[aria-label$="description"]')?.focus(); }
      if (e.key === '/') { e.preventDefault(); document.querySelector<HTMLInputElement>('input[placeholder="Search"]')?.focus(); }
    };
    document.addEventListener('keydown', f);
    return () => document.removeEventListener('keydown', f);
  }, []);

  return (
    <div className="mx-auto w-full max-w-[1180px] px-4 pb-8 expanded:px-8 min-[1024px]:grid min-[1024px]:grid-cols-[minmax(0,560px)_minmax(340px,440px)] min-[1024px]:justify-center min-[1024px]:gap-8">
      {/* form column */}
      <div className="min-w-0">
        <header className="flex h-20 items-center gap-2">
          <h1 className="t-headline flex-1">{title}</h1>
          <button
            type="button"
            aria-label="History"
            title="History"
            onClick={() => setHistoryOpen(true)}
            className="state press flex h-12 w-12 items-center justify-center rounded-full bg-surface-container-high text-on-surface-variant min-[1024px]:hidden"
          >
            <Icon name="history" />
          </button>
          <Link href="/trash" aria-label="Trash" title="Trash" className="state press flex h-12 w-12 items-center justify-center rounded-full bg-surface-container-high text-on-surface-variant">
            <Icon name="delete" />
          </Link>
        </header>

        <EntryForm
          kind={kind}
          editing={editing}
          onCancelEdit={() => setEditing(null)}
          onSaved={onSaved}
          onTrashEditing={onTrash}
        />
      </div>

      {/* history card (desktop, >= 1024px) */}
      <aside className="sticky top-6 mt-6 hidden h-[calc(100dvh-3rem)] flex-col overflow-hidden rounded-[28px] bg-surface-container-low min-[1024px]:flex" aria-label="History">
        <div className="px-5 pb-3 pt-5">
          <h2 className="t-title-lg mb-3">History</h2>
          {searchBox}
        </div>
        <div className="scroller min-h-0 flex-1 px-3 pb-4" style={{ ['--hist-card' as string]: 'var(--md-sys-color-surface-container)', ['--hist-bg' as string]: 'var(--md-sys-color-surface-container-low)' }}>{list}</div>
      </aside>

      {/* pull-down indicator */}
      <div
        aria-hidden
        className="pointer-events-none fixed left-1/2 top-0 z-30 -ml-6 flex h-12 w-12 items-center justify-center rounded-full bg-secondary-container text-on-secondary-container shadow-sm min-[1024px]:hidden"
        style={{ transform: `translateY(${pull ? 12 + pull * 44 : -64}px) scale(${0.6 + pull * 0.4})`, opacity: pull, transition: pull ? 'none' : 'transform 220ms cubic-bezier(0.2,0,0,1), opacity 180ms' }}
      >
        <Icon name={pull >= 1 ? 'history' : 'arrow_downward'} fill={pull >= 1} />
      </div>

      {/* history sheet (phones and small tablets): tap the history button */}
      <AnimatePresence>
        {historyOpen && (
          <motion.div
            key="history"
            ref={swipeHistory}
            className="fixed inset-0 z-40 flex flex-col bg-surface min-[1024px]:hidden"
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ type: 'spring', stiffness: 380, damping: 40 }}
            role="dialog"
            aria-label="History"
          >
            <header className="flex h-16 items-center gap-1 px-2 pt-[env(safe-area-inset-top)]">
              <button type="button" aria-label="Close history" onClick={() => setHistoryOpen(false)} className="state press flex h-12 w-12 items-center justify-center rounded-full text-on-surface-variant">
                <Icon name="arrow_back" />
              </button>
              <h2 className="t-title-lg flex-1">History</h2>
            </header>
            <div className="px-4 pb-2">{searchBox}</div>
            <div className="scroller min-h-0 flex-1 px-4 pb-[max(1.5rem,env(safe-area-inset-bottom))]" style={{ ['--hist-bg' as string]: 'var(--md-sys-color-surface)' }}>{list}</div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
