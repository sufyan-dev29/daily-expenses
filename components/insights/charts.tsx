'use client';
import { useMemo, useState, type ReactNode } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { Icon, cx } from '@/components/ui';
import { useApp } from '@/components/AppProvider';
import { abbreviate } from '@/lib/format';
import { bucketLabel, type Gran } from '@/lib/dates';
import { addDays, format, getDay, parseISO, startOfYear } from 'date-fns';
import type { InsightsData } from '@/components/insights/types';

const GRID = 'color-mix(in srgb, var(--md-sys-color-outline-variant) 60%, transparent)';
const TICK = { fill: 'var(--md-sys-color-on-surface-variant)', fontSize: 12, fontWeight: 500 } as const;
export const catVar = (i: number) => `var(--cat-${(i % 8) + 1})`;

/* ------------------------------------------------------------- shared chart card with table toggle */
export function ChartCard({
  title,
  summary,
  table,
  children,
  className,
}: {
  title: string;
  summary: string;
  table?: { head: string[]; rows: (string | number)[][] };
  children: ReactNode;
  className?: string;
}) {
  const [asTable, setAsTable] = useState(false);
  return (
    <section className={cx('rounded-[28px] bg-surface-container-low p-4', className)} aria-label={title}>
      <div className="mb-2 flex items-center justify-between gap-2">
        <h3 className="t-title-md">{title}</h3>
        {table && (
          <button
            className="state t-label-lg flex h-10 items-center gap-1 rounded-full px-3 text-on-surface-variant"
            aria-pressed={asTable}
            onClick={() => setAsTable((v) => !v)}
          >
            <Icon name={asTable ? 'bar_chart' : 'table'} size={18} />
            {asTable ? 'Chart' : 'Table'}
          </button>
        )}
      </div>
      <p className="sr-only">{summary}</p>
      {asTable && table ? (
        <div className="max-h-72 overflow-auto">
          <table className="t-body-md w-full">
            <thead>
              <tr>{table.head.map((h, i) => <th key={h} className={cx('sticky top-0 bg-surface-container px-2 py-1 font-medium text-on-surface-variant', i ? 'text-right' : 'text-left')}>{h}</th>)}</tr>
            </thead>
            <tbody>
              {table.rows.map((r, i) => (
                <tr key={i} className="border-t border-outline-variant/40">
                  {r.map((c, j) => <td key={j} className={cx('num px-2 py-1.5', j ? 'text-right' : 'text-left')}>{c}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        children
      )}
    </section>
  );
}

function Tip({ active, payload, label, money }: { active?: boolean; payload?: any[]; label?: string; money: (n: number) => string }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="t-body-md rounded-2xl bg-surface-container-highest px-3 py-2 shadow-md">
      {label && <div className="t-label-lg mb-1">{label}</div>}
      {payload.map((p) => (
        <div key={p.dataKey ?? p.name} className="flex items-center gap-2">
          <span className="h-2.5 w-2.5 rounded-full" style={{ background: p.color ?? p.payload?.fill }} />
          <span className="text-on-surface-variant">{p.name}</span>
          <span className="num ml-auto pl-3 font-medium">{money(Number(p.value))}</span>
        </div>
      ))}
    </div>
  );
}

const legendFmt = (v: string) => <span className="t-label-md text-on-surface-variant">{v}</span>;

/* ------------------------------------------------------------- spending over time */
export function SpendingChart({ data, gran, overlay }: { data: InsightsData; gran: Gran; overlay: boolean }) {
  const { money } = useApp();
  const rows = data.series.map((s) => ({ ...s, label: bucketLabel(s.bucket, gran) }));
  const total = rows.reduce((a, r) => a + r.expense, 0);
  return (
    <ChartCard
      title="Spending over time"
      summary={`Total spent ${money(total)} across ${rows.length} ${gran} periods.`}
      table={{ head: ['Period', 'Spent', ...(overlay ? ['Income'] : [])], rows: rows.map((r) => [r.label, money(r.expense), ...(overlay ? [money(r.income)] : [])]) }}
    >
      <div className="h-64 medium:h-72">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={rows} margin={{ top: 8, right: 4, left: 0, bottom: 0 }} barCategoryGap="22%">
            <CartesianGrid vertical={false} stroke={GRID} />
            <XAxis dataKey="label" tick={TICK} tickLine={false} axisLine={false} minTickGap={12} />
            <YAxis tick={TICK} tickLine={false} axisLine={false} tickFormatter={abbreviate} width={44} />
            <Tooltip cursor={{ fill: 'var(--md-sys-color-surface-container-high)', opacity: 0.5 }} content={<Tip money={money} />} />
            {overlay && <Legend verticalAlign="top" height={28} formatter={legendFmt} iconType="circle" iconSize={8} />}
            <Bar dataKey="expense" name="Spent" fill="var(--md-sys-color-expense)" radius={[4, 4, 0, 0]} maxBarSize={28} />
            {overlay && <Bar dataKey="income" name="Income" fill="var(--md-sys-color-income)" radius={[4, 4, 0, 0]} maxBarSize={28} />}
          </BarChart>
        </ResponsiveContainer>
      </div>
    </ChartCard>
  );
}

/* ------------------------------------------------------------- category donut + ranked bars */
export function CategoryBreakdown({ rows, title, onPick }: { rows: { id: string | null; name: string; total: number; count: number }[]; title: string; onPick?: (id: string) => void }) {
  const { money } = useApp();
  const sum = rows.reduce((a, r) => a + r.total, 0);
  const top = rows.slice(0, 8);
  const rest = rows.slice(8).reduce((a, r) => a + r.total, 0);
  const shown = rest > 0 ? [...top, { id: null, name: 'Other', total: rest, count: 0 }] : top;
  return (
    <ChartCard
      title={title}
      summary={`${rows.length} groups. ${rows[0] ? `${rows[0].name} is the largest at ${money(rows[0].total)}.` : 'No data.'}`}
      table={{ head: ['Name', 'Total', 'Share'], rows: rows.map((r) => [r.name, money(r.total), `${sum ? Math.round((r.total / sum) * 100) : 0}%`]) }}
    >
      {!rows.length ? <Empty /> : (
        <div className="flex flex-col items-center gap-4 medium:flex-row">
          <div className="h-48 w-48 shrink-0">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={shown} dataKey="total" nameKey="name" innerRadius="62%" outerRadius="100%" paddingAngle={2} stroke="none" onClick={(d: any) => d?.id && onPick?.(d.id)}>
                  {shown.map((_, i) => <Cell key={i} fill={i === 8 ? 'var(--md-sys-color-outline)' : catVar(i)} />)}
                </Pie>
                <Tooltip content={<Tip money={money} />} />
              </PieChart>
            </ResponsiveContainer>
          </div>
          <ul className="w-full min-w-0 flex-1">
            {shown.map((r, i) => {
              const pct = sum ? (r.total / sum) * 100 : 0;
              return (
                <li key={r.name + i}>
                  <button disabled={!r.id || !onPick} onClick={() => r.id && onPick?.(r.id)} className="state flex min-h-[40px] w-full items-center gap-2 rounded-m3-sm px-1 text-left">
                    <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: i === 8 ? 'var(--md-sys-color-outline)' : catVar(i) }} />
                    <span className="t-body-md min-w-0 flex-1 truncate">{r.name}</span>
                    <span className="num t-body-md text-on-surface-variant">{pct.toFixed(0)}%</span>
                    <span className="num t-body-md w-24 text-right">{money(r.total)}</span>
                  </button>
                  <div className="mx-1 mb-1 h-1.5 rounded-full bg-surface-container-high"><div className="h-full rounded-full" style={{ width: `${pct}%`, background: i === 8 ? 'var(--md-sys-color-outline)' : catVar(i) }} /></div>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </ChartCard>
  );
}

/* ------------------------------------------------------------- need vs want */
export function NeedWantChart({ data, gran }: { data: InsightsData; gran: Gran }) {
  const { money } = useApp();
  const total = data.need_want.reduce((a, r) => a + r.total, 0);
  const get = (k: string) => data.need_want.find((r) => r.key === k)?.total ?? 0;
  const rows = data.nw_series.map((s) => ({ ...s, label: bucketLabel(s.bucket, gran) }));
  const need = get('need');
  const want = get('want');
  const pct = (n: number) => (total ? Math.round((n / total) * 100) : 0);
  return (
    <ChartCard
      title="Need vs want"
      summary={`Need ${money(need)} (${pct(need)}%), want ${money(want)} (${pct(want)}%).`}
      table={{ head: ['Period', 'Need', 'Want'], rows: rows.map((r) => [r.label, money(r.need), money(r.want)]) }}
    >
      {!total ? <Empty /> : (
        <>
          <div className="mb-3 flex h-3 overflow-hidden rounded-full bg-surface-container-high" role="img" aria-label={`Need ${pct(need)}%, Want ${pct(want)}%`}>
            <div style={{ width: `${pct(need)}%`, background: 'var(--cat-1)' }} />
            <div className="ml-0.5" style={{ width: `${pct(want)}%`, background: 'var(--cat-4)' }} />
          </div>
          <div className="t-body-md mb-2 flex gap-4">
            <span className="flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-full" style={{ background: 'var(--cat-1)' }} />Need <b className="num font-medium">{money(need)}</b> · {pct(need)}%</span>
            <span className="flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-full" style={{ background: 'var(--cat-4)' }} />Want <b className="num font-medium">{money(want)}</b> · {pct(want)}%</span>
          </div>
          <div className="h-44">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={rows} margin={{ top: 4, right: 4, left: 0, bottom: 0 }} barCategoryGap="22%">
                <CartesianGrid vertical={false} stroke={GRID} />
                <XAxis dataKey="label" tick={TICK} tickLine={false} axisLine={false} minTickGap={12} />
                <YAxis tick={TICK} tickLine={false} axisLine={false} tickFormatter={abbreviate} width={44} />
                <Tooltip cursor={{ fill: 'var(--md-sys-color-surface-container-high)', opacity: 0.5 }} content={<Tip money={money} />} />
                <Bar dataKey="need" name="Need" stackId="a" fill="var(--cat-1)" maxBarSize={28} stroke="var(--md-sys-color-surface-container)" strokeWidth={2} />
                <Bar dataKey="want" name="Want" stackId="a" fill="var(--cat-4)" radius={[4, 4, 0, 0]} maxBarSize={28} stroke="var(--md-sys-color-surface-container)" strokeWidth={2} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </>
      )}
    </ChartCard>
  );
}

/* ------------------------------------------------------------- horizontal bars (bank / mode) */
export function GroupBars({ title, rows }: { title: string; rows: { name: string; expense: number; income: number }[] }) {
  const { money } = useApp();
  const max = Math.max(1, ...rows.map((r) => Math.max(r.expense, r.income)));
  return (
    <ChartCard
      title={title}
      summary={rows.map((r) => `${r.name}: spent ${money(r.expense)}, income ${money(r.income)}`).join('. ')}
      table={{ head: ['Name', 'Spent', 'Income'], rows: rows.map((r) => [r.name, money(r.expense), money(r.income)]) }}
    >
      {!rows.length ? <Empty /> : (
        <ul className="flex flex-col gap-3">
          {rows.slice(0, 10).map((r) => (
            <li key={r.name}>
              <div className="t-body-md mb-1 flex justify-between"><span className="truncate">{r.name}</span><span className="num text-on-surface-variant">{r.expense ? money(r.expense) : ''}{r.expense && r.income ? ' · ' : ''}{r.income ? `+${money(r.income)}` : ''}</span></div>
              {r.expense > 0 && <div className="mb-0.5 h-2 rounded-full bg-surface-container-high"><div className="h-full rounded-r-full rounded-l-full" style={{ width: `${(r.expense / max) * 100}%`, background: 'var(--md-sys-color-expense)' }} /></div>}
              {r.income > 0 && <div className="h-2 rounded-full bg-surface-container-high"><div className="h-full rounded-full" style={{ width: `${(r.income / max) * 100}%`, background: 'var(--md-sys-color-income)' }} /></div>}
            </li>
          ))}
        </ul>
      )}
    </ChartCard>
  );
}

/* ------------------------------------------------------------- income vs expense net trend (monthly) */
export function NetTrend({ data }: { data: InsightsData }) {
  const { money } = useApp();
  const rows = data.monthly.map((m) => ({ label: bucketLabel(m.bucket, 'month'), expense: m.expense, income: m.income, net: m.income - m.expense }));
  return (
    <ChartCard
      title="Income, spending and net"
      summary={`Net over ${rows.length} months: ${money(rows.reduce((a, r) => a + r.net, 0))}.`}
      table={{ head: ['Month', 'Income', 'Spent', 'Net'], rows: rows.map((r) => [r.label, money(r.income), money(r.expense), money(r.net)]) }}
    >
      {rows.length < 2 ? <Empty text="Needs at least two months of data." /> : (
        <div className="h-64">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={rows} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid vertical={false} stroke={GRID} />
              <XAxis dataKey="label" tick={TICK} tickLine={false} axisLine={false} minTickGap={16} />
              <YAxis tick={TICK} tickLine={false} axisLine={false} tickFormatter={abbreviate} width={44} />
              <Tooltip content={<Tip money={money} />} />
              <Legend verticalAlign="top" height={28} formatter={legendFmt} iconType="circle" iconSize={8} />
              <Line type="monotone" dataKey="income" name="Income" stroke="var(--md-sys-color-income)" strokeWidth={2} dot={{ r: 4, strokeWidth: 2, stroke: 'var(--md-sys-color-surface-container)' }} />
              <Line type="monotone" dataKey="expense" name="Spent" stroke="var(--md-sys-color-expense)" strokeWidth={2} dot={{ r: 4, strokeWidth: 2, stroke: 'var(--md-sys-color-surface-container)' }} />
              <Line type="monotone" dataKey="net" name="Net" stroke="var(--md-sys-color-on-surface-variant)" strokeWidth={2} strokeDasharray="5 4" dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
    </ChartCard>
  );
}

/* ------------------------------------------------------------- day-of-week pattern */
const DOW = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
export function DowChart({ data }: { data: InsightsData }) {
  const { money } = useApp();
  const rows = DOW.map((d, i) => {
    const r = data.dow.find((x) => x.dow === i + 1);
    return { label: d, total: r?.total ?? 0, avg: r && r.days ? r.total / r.days : 0 };
  });
  return (
    <ChartCard
      title="Average spend by weekday"
      summary={`Highest on ${[...rows].sort((a, b) => b.avg - a.avg)[0]?.label}.`}
      table={{ head: ['Day', 'Average', 'Total'], rows: rows.map((r) => [r.label, money(Math.round(r.avg)), money(r.total)]) }}
    >
      <div className="h-52">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={rows} margin={{ top: 8, right: 4, left: 0, bottom: 0 }} barCategoryGap="22%">
            <CartesianGrid vertical={false} stroke={GRID} />
            <XAxis dataKey="label" tick={TICK} tickLine={false} axisLine={false} />
            <YAxis tick={TICK} tickLine={false} axisLine={false} tickFormatter={abbreviate} width={44} />
            <Tooltip cursor={{ fill: 'var(--md-sys-color-surface-container-high)', opacity: 0.5 }} content={<Tip money={money} />} />
            <Bar dataKey="avg" name="Average" fill="var(--md-sys-color-primary)" radius={[4, 4, 0, 0]} maxBarSize={28} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </ChartCard>
  );
}

/* ------------------------------------------------------------- calendar heatmap (daily spend) */
export function Heatmap({ data, to }: { data: InsightsData; to: string }) {
  const { money, settings } = useApp();
  const [hover, setHover] = useState<{ d: string; v: number } | null>(null);
  const map = useMemo(() => new Map(data.daily.map((d) => [d.day, d.total])), [data.daily]);
  const end = parseISO(to > format(new Date(), 'yyyy-MM-dd') ? format(new Date(), 'yyyy-MM-dd') : to);
  const start0 = data.daily.length ? parseISO(data.daily[0].day) : startOfYear(end);
  const earliest = addDays(end, -364);
  const start = start0 > earliest ? start0 : earliest;
  const ws = settings.week_start === 7 ? 0 : settings.week_start; // JS: 0 = Sunday
  const lead = (getDay(start) - ws + 7) % 7;
  const days: (string | null)[] = [...Array(lead).fill(null)];
  for (let d = start; d <= end; d = addDays(d, 1)) days.push(format(d, 'yyyy-MM-dd'));
  const weeks: (string | null)[][] = [];
  for (let i = 0; i < days.length; i += 7) weeks.push(days.slice(i, i + 7));
  const max = Math.max(1, ...data.daily.map((d) => d.total));
  const level = (v: number) => (v <= 0 ? 0 : Math.min(4, Math.ceil((v / max) * 4)));
  const mix = ['transparent', 18, 38, 62, 90];

  return (
    <ChartCard
      title="Daily spending"
      summary={`Calendar of daily spend. Busiest day ${money(max)}.`}
      table={{ head: ['Date', 'Spent'], rows: [...data.daily].sort((a, b) => b.total - a.total).slice(0, 60).map((d) => [d.day, money(d.total)]) }}
    >
      <div className="no-scrollbar overflow-x-auto pb-1">
        <div className="flex gap-[3px]" role="img" aria-label="Calendar heatmap of daily spending">
          {weeks.map((w, wi) => (
            <div key={wi} className="flex flex-col gap-[3px]">
              {w.map((d, di) => {
                const v = d ? map.get(d) ?? 0 : 0;
                const l = level(v);
                return (
                  <span
                    key={di}
                    onMouseEnter={() => d && setHover({ d, v })}
                    onMouseLeave={() => setHover(null)}
                    className="h-[14px] w-[14px] rounded-[3px]"
                    style={{
                      background: !d ? 'transparent' : l === 0 ? 'var(--md-sys-color-surface-container-high)' : `color-mix(in srgb, var(--md-sys-color-expense) ${mix[l]}%, var(--md-sys-color-surface-container-high))`,
                    }}
                  />
                );
              })}
            </div>
          ))}
        </div>
      </div>
      <p className="t-label-md mt-2 h-4 text-on-surface-variant" aria-live="polite">{hover ? `${format(parseISO(hover.d), 'EEE, d MMM yyyy')}: ${hover.v ? money(hover.v) : 'no spending'}` : 'Hover a day for details'}</p>
    </ChartCard>
  );
}

export function Empty({ text = 'No data for these filters.' }: { text?: string }) {
  return <p className="t-body-md py-10 text-center text-on-surface-variant">{text}</p>;
}
