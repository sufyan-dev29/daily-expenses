'use client';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Button, Chip, Field, Icon, Segmented, Sheet, Skeleton, cx, useDebounced } from '@/components/ui';
import { useApp } from '@/components/AppProvider';
import { supabaseBrowser } from '@/lib/supabase/browser';
import { PRESET_LABELS, presetRange, previousRange, type Gran, type Preset } from '@/lib/dates';
import { formatDate } from '@/lib/format';
import { TX_COLUMNS } from '@/lib/tx';
import { CategoryBreakdown, DowChart, Empty, GroupBars, Heatmap, NeedWantChart, NetTrend, SpendingChart } from '@/components/insights/charts';
import type { Filters, InsightsData } from '@/components/insights/types';
import type { Transaction } from '@/lib/types';

const EMPTY: InsightsData = {
  totals: { spent: 0, income: 0, count: 0, expense_count: 0, biggest: null },
  series: [], monthly: [], by_category: [], by_source: [], by_bank: [], by_mode: [], need_want: [], nw_series: [], top: [], daily: [], dow: [],
};

function useFilters(): [Filters, (patch: Partial<Filters>) => void, () => void] {
  const sp = useSearchParams();
  const router = useRouter();
  const path = usePathname();
  const { settings, today } = useApp();

  const f = useMemo<Filters>(() => {
    const preset = sp.get('preset') ?? 'this_month';
    const r = preset === 'custom' ? { from: sp.get('from') ?? today(), to: sp.get('to') ?? today() } : presetRange(preset as Preset, today(), settings.week_start);
    return {
      preset,
      from: r.from,
      to: r.to,
      gran: (sp.get('gran') as Gran) ?? 'day',
      kind: (sp.get('kind') as Filters['kind']) ?? '',
      category: sp.get('category') ?? '',
      bank: sp.get('bank') ?? '',
      mode: sp.get('mode') ?? '',
      nw: (sp.get('nw') as Filters['nw']) ?? '',
      source: sp.get('source') ?? '',
      min: sp.get('min') ?? '',
      max: sp.get('max') ?? '',
      q: sp.get('q') ?? '',
      cmp: (sp.get('cmp') as '0' | '1') ?? '1',
      overlay: (sp.get('overlay') as '0' | '1') ?? '0',
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sp, settings.week_start]);

  const set = useCallback(
    (patch: Partial<Filters>) => {
      const next = new URLSearchParams(sp.toString());
      Object.entries(patch).forEach(([k, v]) => {
        if (v === '' || v == null) next.delete(k);
        else next.set(k, String(v));
      });
      if (patch.from || patch.to) next.set('preset', 'custom');
      router.replace(`${path}?${next.toString()}`, { scroll: false });
    },
    [sp, router, path],
  );
  const clear = useCallback(() => {
    const next = new URLSearchParams();
    ['preset', 'from', 'to', 'gran', 'cmp', 'overlay'].forEach((k) => sp.get(k) && next.set(k, sp.get(k)!));
    router.replace(`${path}?${next.toString()}`, { scroll: false });
  }, [sp, router, path]);
  return [f, set, clear];
}

function rpcArgs(f: Filters, from: string, to: string, weekStart: number) {
  return {
    p_from: from,
    p_to: to,
    p_gran: f.gran,
    p_kind: f.kind || null,
    p_category: f.category || null,
    p_bank: f.bank || null,
    p_mode: f.mode || null,
    p_need_want: f.nw || null,
    p_source: f.source || null,
    p_min: f.min ? Number(f.min) : null,
    p_max: f.max ? Number(f.max) : null,
    p_q: f.q || null,
    p_week_start: weekStart,
  };
}

function Delta({ cur, prev, goodWhenUp }: { cur: number; prev: number | null; goodWhenUp: boolean }) {
  if (prev == null) return null;
  if (prev === 0 && cur === 0) return null;
  const diff = cur - prev;
  const pct = prev ? (diff / prev) * 100 : null;
  const up = diff >= 0;
  const good = up === goodWhenUp;
  return (
    <span className={cx('t-label-md mt-1 inline-flex items-center gap-0.5 rounded-full px-2 py-0.5', diff === 0 ? 'bg-surface-container-high text-on-surface-variant' : good ? 'bg-income-container text-on-income-container' : 'bg-expense-container text-on-expense-container')}>
      <Icon name={up ? 'arrow_upward' : 'arrow_downward'} size={14} />
      {pct == null ? 'new' : `${Math.abs(pct).toFixed(0)}%`}
    </span>
  );
}

export function InsightsView() {
  const { settings, optionsOf, optionName, money, today, dayLabel } = useApp();
  const [f, set, clear] = useFilters();
  const [data, setData] = useState<InsightsData | null>(null);
  const [prev, setPrev] = useState<InsightsData | null>(null);
  const [err, setErr] = useState('');
  const [sheet, setSheet] = useState(false);
  const [qLocal, setQLocal] = useState(f.q);
  const dq = useDebounced(qLocal, 350);
  useEffect(() => { if (dq !== f.q) set({ q: dq }); /* eslint-disable-next-line */ }, [dq]);

  const key = JSON.stringify(f);
  useEffect(() => {
    let alive = true;
    (async () => {
      setErr('');
      const supabase = supabaseBrowser();
      const cur = await supabase.rpc('insights', rpcArgs(f, f.from, f.to, settings.week_start));
      if (!alive) return;
      if (cur.error) { setErr(cur.error.message); setData(EMPTY); return; }
      setData(cur.data as InsightsData);
      if (f.cmp === '1' && f.preset !== 'all') {
        const p = previousRange(f.from, f.to);
        const r = await supabase.rpc('insights', rpcArgs(f, p.from, p.to, settings.week_start));
        if (alive) setPrev(r.error ? null : (r.data as InsightsData));
      } else setPrev(null);
    })();
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, settings.week_start]);

  const active: { label: string; clear: () => void }[] = [];
  if (f.kind) active.push({ label: f.kind === 'expense' ? 'Expenses' : 'Income', clear: () => set({ kind: '' }) });
  if (f.category) active.push({ label: optionName(f.category), clear: () => set({ category: '' }) });
  if (f.bank) active.push({ label: optionName(f.bank), clear: () => set({ bank: '' }) });
  if (f.mode) active.push({ label: optionName(f.mode), clear: () => set({ mode: '' }) });
  if (f.source) active.push({ label: optionName(f.source), clear: () => set({ source: '' }) });
  if (f.nw) active.push({ label: f.nw === 'need' ? 'Need' : 'Want', clear: () => set({ nw: '' }) });
  if (f.min) active.push({ label: `≥ ${f.min}`, clear: () => set({ min: '' }) });
  if (f.max) active.push({ label: `≤ ${f.max}`, clear: () => set({ max: '' }) });
  if (f.q) active.push({ label: `“${f.q}”`, clear: () => { setQLocal(''); set({ q: '' }); } });

  const t = data?.totals ?? EMPTY.totals;
  const net = t.income - t.spent;
  const pNet = prev ? prev.totals.income - prev.totals.spent : null;
  const days = Math.max(1, Math.round((new Date(f.to).getTime() - new Date(f.from).getTime()) / 86_400_000) + 1);
  const avg = t.spent / (f.preset === 'all' ? Math.max(1, data?.daily.length ?? 1) : days);

  const filterPanel = (
    <div className="flex flex-col gap-4 px-4 pb-2">
      <div className="grid grid-cols-1 gap-3 medium:grid-cols-2">
        <Select label="Category" value={f.category} onChange={(v) => set({ category: v })} items={optionsOf('category', true)} />
        <Select label="Bank" value={f.bank} onChange={(v) => set({ bank: v })} items={optionsOf('bank', true)} />
        <Select label="Payment mode" value={f.mode} onChange={(v) => set({ mode: v })} items={optionsOf('payment_mode', true)} />
        <Select label="Income source" value={f.source} onChange={(v) => set({ source: v })} items={optionsOf('income_source', true)} />
        <Field label="Min amount" inputMode="decimal" value={f.min} onChange={(e) => set({ min: e.target.value.replace(/[^0-9.]/g, '') })} />
        <Field label="Max amount" inputMode="decimal" value={f.max} onChange={(e) => set({ max: e.target.value.replace(/[^0-9.]/g, '') })} />
      </div>
      <Segmented label="Need or want" value={(f.nw || null) as 'need' | 'want' | null} onChange={(v) => set({ nw: f.nw === v ? '' : v })} options={[{ value: 'need', label: 'Need' }, { value: 'want', label: 'Want', tone: 'want' }]} />
    </div>
  );

  return (
    <div className="mx-auto w-full max-w-[1280px] px-4 pb-12 medium:px-6 expanded:px-8">
      <header className="flex h-20 items-center gap-2">
        <h1 className="t-headline flex-1">Insights</h1>
        <a href={`/api/export?from=${f.from}&to=${f.to}${f.kind ? `&kind=${f.kind}` : ''}`} className="state t-label-lg state press flex h-10 items-center gap-1 rounded-full bg-secondary-container px-4 text-on-secondary-container">
          <Icon name="download" size={18} /> CSV
        </a>
      </header>

      {/* filter bar */}
      <div className="sticky top-0 z-20 -mx-4 bg-surface px-4 pb-2 pt-1 medium:-mx-6 medium:px-6 expanded:-mx-8 expanded:px-8">
        <div className="flex flex-wrap items-center gap-2">
          <label className="relative">
            <span className="sr-only">Date range</span>
            <select value={f.preset} onChange={(e) => set({ preset: e.target.value, from: '', to: '' })} className="t-label-lg h-10 appearance-none rounded-full border-2 border-transparent bg-surface-container-high pl-4 pr-9 text-on-surface focus:outline-none focus:ring-2 focus:ring-primary">
              {(Object.keys(PRESET_LABELS) as Preset[]).map((p) => <option key={p} value={p}>{PRESET_LABELS[p]}</option>)}
            </select>
            <Icon name="expand_more" size={18} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2" />
          </label>
          <div className="w-full max-w-[320px] flex-none medium:w-auto">
            <Segmented label="Group by" value={f.gran} onChange={(v) => set({ gran: v })} className="!h-10" options={[{ value: 'day', label: 'Day' }, { value: 'week', label: 'Week' }, { value: 'month', label: 'Month' }, { value: 'year', label: 'Year' }]} />
          </div>
          <div className="w-[160px]">
            <Segmented label="Entry kind" value={(f.kind || 'both') as 'both' | 'expense' | 'income'} onChange={(v) => set({ kind: v === 'both' ? '' : v })} className="!h-10" options={[{ value: 'both', label: 'All' }, { value: 'expense', label: 'Out' }, { value: 'income', label: 'In' }]} />
          </div>
          <Chip icon="tune" onClick={() => setSheet(true)} className="expanded:hidden">Filters</Chip>
          <label className="relative hidden expanded:block">
            <span className="sr-only">Search</span>
            <Icon name="search" size={18} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-on-surface-variant" />
            <input value={qLocal} onChange={(e) => setQLocal(e.target.value)} placeholder="Search entries" className="t-label-lg h-10 w-52 rounded-full border-2 border-transparent bg-surface-container-high pl-9 pr-3 focus:outline-none focus:ring-2 focus:ring-primary" />
          </label>
        </div>

        {f.preset === 'custom' && (
          <div className="mt-2 flex gap-2">
            <Field className="flex-1" label="From" type="date" value={f.from} onChange={(e) => set({ from: e.target.value })} />
            <Field className="flex-1" label="To" type="date" value={f.to} onChange={(e) => set({ to: e.target.value })} />
          </div>
        )}

        {/* desktop: inline filters */}
        <div className="mt-2 hidden flex-wrap gap-2 expanded:flex">
          <Select compact label="Category" value={f.category} onChange={(v) => set({ category: v })} items={optionsOf('category', true)} />
          <Select compact label="Bank" value={f.bank} onChange={(v) => set({ bank: v })} items={optionsOf('bank', true)} />
          <Select compact label="Payment mode" value={f.mode} onChange={(v) => set({ mode: v })} items={optionsOf('payment_mode', true)} />
          <Select compact label="Income source" value={f.source} onChange={(v) => set({ source: v })} items={optionsOf('income_source', true)} />
          <Select compact label="Need / want" value={f.nw} onChange={(v) => set({ nw: v as Filters['nw'] })} items={[{ id: 'need', name: 'Need' }, { id: 'want', name: 'Want' }] as never} />
          <input aria-label="Min amount" inputMode="decimal" placeholder="Min" value={f.min} onChange={(e) => set({ min: e.target.value.replace(/[^0-9.]/g, '') })} className="t-label-lg h-10 w-24 rounded-full border-2 border-transparent bg-surface-container-high px-4" />
          <input aria-label="Max amount" inputMode="decimal" placeholder="Max" value={f.max} onChange={(e) => set({ max: e.target.value.replace(/[^0-9.]/g, '') })} className="t-label-lg h-10 w-24 rounded-full border-2 border-transparent bg-surface-container-high px-4" />
        </div>

        <div className="no-scrollbar mt-2 flex items-center gap-2 overflow-x-auto">
          <span className="t-label-md shrink-0 text-on-surface-variant">{formatDate(f.from, 'd MMM')} – {formatDate(f.to, 'd MMM yyyy')}</span>
          {active.map((a) => <Chip key={a.label} selected onRemove={a.clear}>{a.label}</Chip>)}
          {active.length > 0 && <button className="t-label-lg shrink-0 px-2 text-primary" onClick={() => { setQLocal(''); clear(); }}>Clear all</button>}
        </div>
      </div>

      {err && <p role="alert" className="t-body-md my-3 rounded-2xl bg-error-container px-4 py-3 text-on-error-container">{err.includes('insights') ? 'The insights function is missing. Run the setup migrations again.' : err}</p>}

      {!data ? (
        <div className="mt-4 grid gap-3 medium:grid-cols-2 large:grid-cols-4">{Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-24" />)}</div>
      ) : (
        <>
          {/* summary */}
          <div className="mt-3 grid grid-cols-2 gap-3 large:grid-cols-4">
            <Stat label="Spent" value={money(t.spent)} tone="expense"><Delta cur={t.spent} prev={prev?.totals.spent ?? null} goodWhenUp={false} /></Stat>
            <Stat label="Income" value={money(t.income)} tone="income"><Delta cur={t.income} prev={prev?.totals.income ?? null} goodWhenUp /></Stat>
            <Stat label="Net" value={`${net < 0 ? '−' : ''}${money(Math.abs(net))}`} tone={net < 0 ? 'expense' : 'income'}><Delta cur={net} prev={pNet} goodWhenUp /></Stat>
            <Stat label="Average per day" value={money(Math.round(avg))}><Delta cur={avg} prev={prev ? prev.totals.spent / days : null} goodWhenUp={false} /></Stat>
            <Stat label="Biggest expense" value={t.biggest ? money(t.biggest.amount) : '—'} sub={t.biggest?.name} />
            <Stat label="Transactions" value={String(t.count)}><Delta cur={t.count} prev={prev?.totals.count ?? null} goodWhenUp /></Stat>
            <div className="col-span-2 flex items-center justify-end">
              <label className="t-label-lg flex min-h-[48px] items-center gap-2">
                <input type="checkbox" checked={f.cmp === '1'} onChange={(e) => set({ cmp: e.target.checked ? '1' : '0' })} className="h-5 w-5 accent-[var(--md-sys-color-primary)]" />
                Compare with previous period
              </label>
              <label className="t-label-lg ml-4 flex min-h-[48px] items-center gap-2">
                <input type="checkbox" checked={f.overlay === '1'} onChange={(e) => set({ overlay: e.target.checked ? '1' : '0' })} className="h-5 w-5 accent-[var(--md-sys-color-primary)]" />
                Show income
              </label>
            </div>
          </div>

          {t.count === 0 ? (
            <div className="mt-6 rounded-[28px] bg-surface-container-low p-6"><Empty text="No entries match these filters. Try a wider date range." /></div>
          ) : (
            <div className="mt-4 grid grid-cols-1 gap-4 large:grid-cols-2">
              <div className="large:col-span-2"><SpendingChart data={data} gran={f.gran} overlay={f.overlay === '1' || f.kind === 'income'} /></div>
              <CategoryBreakdown title="Spending by category" rows={data.by_category} onPick={(id) => set({ category: id })} />
              <NeedWantChart data={data} gran={f.gran} />
              {data.by_source.length > 0 && <CategoryBreakdown title="Income by source" rows={data.by_source} onPick={(id) => set({ source: id })} />}
              <GroupBars title="By bank" rows={data.by_bank} />
              <GroupBars title="By payment mode" rows={data.by_mode} />
              <NetTrend data={data} />
              <DowChart data={data} />
              <div className="large:col-span-2"><Heatmap data={data} to={f.to} /></div>
              <TopList data={data} />
            </div>
          )}

          <EntriesTable f={f} />
        </>
      )}

      <Sheet open={sheet} onClose={() => setSheet(false)} title="Filters" footer={<div className="flex gap-2"><Button variant="outlined" className="flex-1" onClick={() => { setQLocal(''); clear(); }}>Clear all</Button><Button className="flex-1" onClick={() => setSheet(false)}>Done</Button></div>}>
        <div className="px-4 pb-3">
          <Field label="Search" value={qLocal} onChange={(e) => setQLocal(e.target.value)} placeholder="Name or notes" />
        </div>
        {filterPanel}
      </Sheet>
    </div>
  );
}

function Select({ label, value, onChange, items, compact }: { label: string; value: string; onChange: (v: string) => void; items: { id: string; name: string }[]; compact?: boolean }) {
  return (
    <label className={compact ? 'relative' : 'block'}>
      <span className={compact ? 'sr-only' : 't-label-md mb-1 block text-on-surface-variant'}>{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)} className={cx('t-label-lg appearance-none border-2 border-transparent bg-surface-container-high text-on-surface focus:outline-none focus:ring-2 focus:ring-primary', compact ? 'h-10 rounded-full pl-4 pr-9' : 'h-14 w-full rounded-2xl px-4 t-body-lg')}>
        <option value="">{compact ? label : 'All'}</option>
        {items.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
      </select>
      {compact && <Icon name="expand_more" size={18} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2" />}
    </label>
  );
}

function Stat({ label, value, sub, tone, children }: { label: string; value: string; sub?: string; tone?: 'expense' | 'income'; children?: React.ReactNode }) {
  return (
    <div className="rounded-[28px] bg-surface-container-low p-4">
      <div className="t-label-md text-on-surface-variant">{label}</div>
      <div className={cx('num mt-1 truncate text-[22px] font-semibold leading-7 tracking-tight expanded:text-[28px] expanded:leading-9', tone === 'expense' && 'text-expense', tone === 'income' && 'text-income')}>{value}</div>
      {sub && <div className="t-body-md truncate text-on-surface-variant">{sub}</div>}
      {children}
    </div>
  );
}

function TopList({ data }: { data: InsightsData }) {
  const { money, dayLabel } = useApp();
  return (
    <section className="rounded-[28px] bg-surface-container-low p-4 large:col-span-2" aria-label="Top expenses">
      <h3 className="t-title-md mb-2">Top expenses</h3>
      <ol className="grid gap-x-8 medium:grid-cols-2">
        {data.top.map((r, i) => (
          <li key={r.id} className="flex min-h-[48px] items-center gap-3 border-b border-outline-variant/40">
            <span className="t-label-md w-5 text-on-surface-variant">{i + 1}</span>
            <span className="min-w-0 flex-1"><span className="t-body-lg block truncate">{r.name}</span><span className="t-body-md block text-on-surface-variant">{dayLabel(r.occurred_on)}{r.category ? ` · ${r.category}` : ''}</span></span>
            <span className="num t-title-md text-expense">{money(r.amount)}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}

/* ------------------------------------------------------------- filtered rows table (server pagination + sort) */
function EntriesTable({ f }: { f: Filters }) {
  const { money, optionName } = useApp();
  const [rows, setRows] = useState<Transaction[]>([]);
  const [count, setCount] = useState(0);
  const [page, setPage] = useState(0);
  const [sort, setSort] = useState<{ col: 'occurred_on' | 'amount' | 'name'; asc: boolean }>({ col: 'occurred_on', asc: false });
  const SIZE = 25;
  const key = JSON.stringify({ ...f, gran: '', cmp: '', overlay: '' });
  useEffect(() => { setPage(0); }, [key]);

  useEffect(() => {
    let alive = true;
    (async () => {
      let q = supabaseBrowser().from('transactions').select(TX_COLUMNS, { count: 'exact' }).is('deleted_at', null).gte('occurred_on', f.from).lte('occurred_on', f.to);
      if (f.kind) q = q.eq('kind', f.kind);
      if (f.category) q = q.eq('category_id', f.category);
      if (f.bank) q = q.eq('bank_id', f.bank);
      if (f.mode) q = q.eq('payment_mode_id', f.mode);
      if (f.source) q = q.eq('income_source_id', f.source);
      if (f.nw) q = q.eq('need_want', f.nw);
      if (f.min) q = q.gte('amount', Number(f.min));
      if (f.max) q = q.lte('amount', Number(f.max));
      if (f.q) q = q.ilike('name', `%${f.q.replace(/[%_,()]/g, '')}%`);
      const { data, count: c } = await q.order(sort.col, { ascending: sort.asc }).order('created_at', { ascending: false }).range(page * SIZE, page * SIZE + SIZE - 1);
      if (!alive) return;
      setRows((data ?? []) as Transaction[]);
      setCount(c ?? 0);
    })();
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, page, sort]);

  const th = (col: typeof sort.col, label: string, right?: boolean) => (
    <th className={cx('px-3 py-2 font-medium text-on-surface-variant', right ? 'text-right' : 'text-left')} aria-sort={sort.col === col ? (sort.asc ? 'ascending' : 'descending') : 'none'}>
      <button className="inline-flex min-h-[40px] items-center gap-1" onClick={() => setSort((s) => ({ col, asc: s.col === col ? !s.asc : false }))}>
        {label}{sort.col === col && <Icon name={sort.asc ? 'arrow_upward' : 'arrow_downward'} size={14} />}
      </button>
    </th>
  );
  const pages = Math.max(1, Math.ceil(count / SIZE));
  const csv = `/api/export?from=${f.from}&to=${f.to}${f.kind ? `&kind=${f.kind}` : ''}`;

  return (
    <section className="mt-4 rounded-[28px] bg-surface-container-low p-4" aria-label="Entries">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="t-title-md">Entries <span className="t-body-md font-normal text-on-surface-variant">({count})</span></h3>
        <a href={csv} className="state t-label-lg flex h-10 items-center gap-1 rounded-full px-3 text-primary"><Icon name="download" size={18} />Export CSV</a>
      </div>
      <div className="overflow-x-auto">
        <table className="t-body-md w-full min-w-[640px]">
          <thead><tr>{th('occurred_on', 'Date')}{th('name', 'Name')}<th className="px-3 py-2 text-left font-medium text-on-surface-variant">Category</th><th className="px-3 py-2 text-left font-medium text-on-surface-variant">Bank</th>{th('amount', 'Amount', true)}</tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-t border-outline-variant/40">
                <td className="num whitespace-nowrap px-3 py-2">{formatDate(r.occurred_on, 'd MMM')}</td>
                <td className="max-w-[240px] truncate px-3 py-2">{r.name}</td>
                <td className="px-3 py-2 text-on-surface-variant">{optionName(r.kind === 'expense' ? r.category_id : r.income_source_id)}</td>
                <td className="px-3 py-2 text-on-surface-variant">{optionName(r.bank_id)}</td>
                <td className={cx('num px-3 py-2 text-right font-medium', r.kind === 'expense' ? 'text-expense' : 'text-income')}>{r.kind === 'expense' ? '−' : '+'}{money(r.amount)}</td>
              </tr>
            ))}
            {!rows.length && <tr><td colSpan={5}><Empty /></td></tr>}
          </tbody>
        </table>
      </div>
      {pages > 1 && (
        <div className="mt-2 flex items-center justify-end gap-2">
          <span className="t-label-md text-on-surface-variant">Page {page + 1} of {pages}</span>
          <button className="state flex h-12 w-12 items-center justify-center rounded-full disabled:opacity-40" disabled={page === 0} onClick={() => setPage((p) => p - 1)} aria-label="Previous page"><Icon name="chevron_left" /></button>
          <button className="state flex h-12 w-12 items-center justify-center rounded-full disabled:opacity-40" disabled={page + 1 >= pages} onClick={() => setPage((p) => p + 1)} aria-label="Next page"><Icon name="chevron_right" /></button>
        </div>
      )}
    </section>
  );
}
