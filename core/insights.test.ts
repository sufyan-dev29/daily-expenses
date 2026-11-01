import { test } from 'node:test';
import assert from 'node:assert/strict';
import { memoryDb } from './test-db.ts';
import { migrate } from './schema.ts';
import { insights, type Gran, type InsightsParams } from './insights.ts';

// ---------- deterministic data
function rng(seed: number) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const pad = (n: number) => String(n).padStart(2, '0');
const iso = (d: Date) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
const addDays = (d: Date, n: number) => new Date(d.getTime() + n * 86400000);
const parse = (s: string) => new Date(`${s}T00:00:00Z`);
const isodow = (d: Date) => d.getUTCDay() || 7;

interface Row {
  id: string; kind: 'expense' | 'income'; name: string; minor: number; on: string;
  cat: string | null; bank: string | null; mode: string | null; src: string | null;
  nw: 'need' | 'want' | null; notes: string | null; deleted: boolean;
}
interface Opt { id: string; kind: string; name: string; color: string | null }

async function seed(count: number, seedNo: number) {
  const db = memoryDb();
  await migrate(db);
  const r = rng(seedNo);
  const pick = <T>(a: T[]) => a[Math.floor(r() * a.length)];
  const opts: Opt[] = [];
  const mk = async (kind: string, names: string[]) => {
    for (const [i, name] of names.entries()) {
      const o = { id: `${kind}-${i}`, kind, name, color: i % 2 ? '#aa3300' : null };
      opts.push(o);
      await db.run('INSERT INTO options (id, kind, name, color, sort_order) VALUES (?,?,?,?,?)', [o.id, kind, name, o.color, i]);
    }
  };
  await mk('category', ['Groceries', 'Utilities', 'Education', 'Housing']);
  await mk('bank', ['MCB', 'JS Bank', 'Cash Box']);
  await mk('payment_mode', ['Cash', 'Card']);
  await mk('income_source', ['Salary', 'Business']);
  const names = ['Milk 100%', 'Rent_June', 'School fees', 'Bus', 'Gift', 'Dinner', 'Salary', 'Invoice 42'];
  const rows: Row[] = [];
  const start = parse('2024-01-01');
  for (let i = 0; i < count; i++) {
    const kind: Row['kind'] = r() < 0.2 ? 'income' : 'expense';
    const on = iso(addDays(start, Math.floor(r() * 1035)));
    const row: Row = {
      id: `t${i}`, kind, name: pick(names), minor: 1 + Math.floor(r() * 500000), on,
      cat: kind === 'expense' && r() < 0.9 ? `category-${Math.floor(r() * 4)}` : null,
      bank: r() < 0.8 ? `bank-${Math.floor(r() * 3)}` : null,
      mode: r() < 0.8 ? `payment_mode-${Math.floor(r() * 2)}` : null,
      src: kind === 'income' && r() < 0.8 ? `income_source-${Math.floor(r() * 2)}` : null,
      nw: kind === 'expense' && r() < 0.7 ? (r() < 0.5 ? 'need' : 'want') : null,
      notes: r() < 0.3 ? pick(['paid late', '50% off', 'a_b', null as unknown as string]) : null,
      deleted: r() < 0.05,
    };
    rows.push(row);
    await db.run(
      `INSERT INTO transactions (id, kind, name, amount_minor, occurred_on, category_id, bank_id, payment_mode_id, income_source_id, need_want, notes, deleted_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
      [row.id, row.kind, row.name, row.minor, row.on, row.cat, row.bank, row.mode, row.src, row.nw, row.notes, row.deleted ? '2026-01-01T00:00:00Z' : null],
    );
  }
  return { db, rows, opts };
}

// ---------- independent reference (written from the original Postgres definition, not from the SQL port)
function pgBucket(on: string, gran: Gran, ws: number): string {
  const d = parse(on);
  if (gran === 'day') return on;
  if (gran === 'month') return `${on.slice(0, 7)}-01`;
  if (gran === 'year') return `${on.slice(0, 4)}-01-01`;
  const shift = (8 - ws) % 7;
  const d2 = addDays(d, shift);
  const monday = addDays(d2, -(isodow(d2) - 1));
  return iso(addDays(monday, -shift));
}

function reference(rows: Row[], opts: Opt[], p: InsightsParams) {
  const gran = p.gran ?? 'day';
  const ws = p.weekStart ?? 1;
  const name = (id: string | null) => (id ? opts.find((o) => o.id === id)!.name : null);
  const color = (id: string | null) => (id ? opts.find((o) => o.id === id)!.color : null);
  const f = rows.filter((t) => {
    if (t.deleted || t.on < p.from || t.on > p.to) return false;
    if (p.kind && t.kind !== p.kind) return false;
    if (p.category && t.cat !== p.category) return false;
    if (p.bank && t.bank !== p.bank) return false;
    if (p.mode && t.mode !== p.mode) return false;
    if (p.needWant && t.nw !== p.needWant) return false;
    if (p.source && t.src !== p.source) return false;
    if (p.min != null && t.minor < Math.round(p.min * 100)) return false;
    if (p.max != null && t.minor > Math.round(p.max * 100)) return false;
    if (p.q) {
      const q = p.q.toLowerCase();
      if (!t.name.toLowerCase().includes(q) && !(t.notes ?? '').toLowerCase().includes(q)) return false;
    }
    return true;
  });
  const exp = f.filter((t) => t.kind === 'expense');
  const inc = f.filter((t) => t.kind === 'income');
  const sum = (a: Row[]) => a.reduce((s, t) => s + t.minor, 0);
  const m = (n: number) => n / 100;
  const group = <K>(a: Row[], key: (t: Row) => K) => {
    const mp = new Map<K, Row[]>();
    for (const t of a) mp.set(key(t), [...(mp.get(key(t)) ?? []), t]);
    return mp;
  };
  const cmpId = (a: string | null, b: string | null) => (a === b ? 0 : a === null ? -1 : b === null ? 1 : a < b ? -1 : 1);
  const bigs = [...exp].sort((a, b) => b.minor - a.minor || (b.on < a.on ? -1 : b.on > a.on ? 1 : 0));
  const sortedBuckets = <T extends { bucket: string }>(a: T[]) => a.sort((x, y) => (x.bucket < y.bucket ? -1 : 1));

  const byOpt = (a: Row[], key: (t: Row) => string | null, nullName: string) =>
    [...group(a, key)].map(([id, ts]) => ({ id, name: name(id) ?? nullName, color: color(id), total: m(sum(ts)), count: ts.length }))
      .sort((x, y) => y.total - x.total || (x.name < y.name ? -1 : x.name > y.name ? 1 : 0) || cmpId(x.id, y.id));
  const split = (key: (t: Row) => string | null) =>
    [...group(f, key)].map(([id, ts]) => ({
      id, name: name(id) ?? 'Unspecified',
      expense: m(sum(ts.filter((t) => t.kind === 'expense'))), income: m(sum(ts.filter((t) => t.kind === 'income'))),
    })).sort((x, y) => y.expense + y.income - (x.expense + x.income) || (x.name < y.name ? -1 : x.name > y.name ? 1 : 0) || cmpId(x.id, y.id));

  return {
    totals: {
      spent: m(sum(exp)), income: m(sum(inc)), count: f.length, expense_count: exp.length,
      biggest: bigs[0] ? { name: bigs[0].name, amount: m(bigs[0].minor) } : null,
    },
    series: sortedBuckets([...group(f, (t) => pgBucket(t.on, gran, ws))].map(([bucket, ts]) => ({
      bucket, expense: m(sum(ts.filter((t) => t.kind === 'expense'))), income: m(sum(ts.filter((t) => t.kind === 'income'))), count: ts.length,
    }))),
    monthly: sortedBuckets([...group(f, (t) => pgBucket(t.on, 'month', ws))].map(([bucket, ts]) => ({
      bucket, expense: m(sum(ts.filter((t) => t.kind === 'expense'))), income: m(sum(ts.filter((t) => t.kind === 'income'))),
    }))),
    by_category: byOpt(exp, (t) => t.cat, 'Uncategorized'),
    by_source: byOpt(inc, (t) => t.src, 'Unspecified'),
    by_bank: split((t) => t.bank),
    by_mode: split((t) => t.mode),
    need_want: [...group(exp, (t) => t.nw ?? 'unspecified')].map(([key, ts]) => ({ key, total: m(sum(ts)), count: ts.length })).sort((x, y) => (x.key < y.key ? -1 : 1)),
    nw_series: sortedBuckets([...group(exp, (t) => pgBucket(t.on, gran, ws))].map(([bucket, ts]) => ({
      bucket, need: m(sum(ts.filter((t) => t.nw === 'need'))), want: m(sum(ts.filter((t) => t.nw === 'want'))), unspecified: m(sum(ts.filter((t) => t.nw === null))),
    }))),
    top: [...exp].sort((a, b) => b.minor - a.minor || (b.on < a.on ? -1 : b.on > a.on ? 1 : 0) || (a.id < b.id ? -1 : 1)).slice(0, 10)
      .map((t) => ({ id: t.id, name: t.name, amount: m(t.minor), occurred_on: t.on, category: name(t.cat) })),
    daily: [...group(exp, (t) => t.on)].map(([day, ts]) => ({ day, total: m(sum(ts)) })).sort((x, y) => (x.day < y.day ? -1 : 1)),
    dow: [...group(exp, (t) => isodow(parse(t.on)))].map(([dow, ts]) => ({ dow, total: m(sum(ts)), days: new Set(ts.map((t) => t.on)).size })).sort((x, y) => x.dow - y.dow),
  };
}

// The "biggest" tie-break and the "top" tie-break are by amount, date, id; the reference mirrors that.
function normalise(x: unknown): unknown {
  return JSON.parse(JSON.stringify(x));
}

const RANGES: [string, string][] = [['2024-01-01', '2026-12-31'], ['2025-03-10', '2025-09-02'], ['2026-10-01', '2026-11-01']];
const GRANS: Gran[] = ['day', 'week', 'month', 'year'];

test('SQLite Insights matches an independent reference across ranges, granularities and week starts', async () => {
  const { db, rows, opts } = await seed(500, 1234);
  let checks = 0;
  for (const [from, to] of RANGES) {
    for (const gran of GRANS) {
      for (const weekStart of gran === 'week' ? [1, 2, 3, 4, 5, 6, 7] : [1]) {
        const p: InsightsParams = { from, to, gran, weekStart };
        assert.deepEqual(normalise(await insights(db, p)), normalise(reference(rows, opts, p)), JSON.stringify(p));
        checks++;
      }
    }
  }
  assert.equal(checks, 30);
});

test('filters (kind, category, bank, mode, need/want, source, min/max, text) match the reference', async () => {
  const { db, rows, opts } = await seed(600, 99);
  const base = { from: '2024-01-01', to: '2026-12-31', gran: 'month' as Gran };
  const cases: Partial<InsightsParams>[] = [
    { kind: 'expense' }, { kind: 'income' }, { category: 'category-1' }, { bank: 'bank-2' }, { mode: 'payment_mode-0' },
    { needWant: 'need' }, { needWant: 'want' }, { source: 'income_source-1' }, { min: 500, max: 2500 }, { min: 4000 },
    { q: 'milk' }, { q: '100%' }, { q: 'a_b' }, { q: 'RENT' }, { q: 'late' }, { kind: 'expense', category: 'category-0', min: 100, q: 'fees' },
  ];
  for (const c of cases) {
    const p = { ...base, ...c };
    assert.deepEqual(normalise(await insights(db, p)), normalise(reference(rows, opts, p)), JSON.stringify(c));
  }
});

test('week buckets: hand-checked dates (2026-11-01 is a Sunday)', async () => {
  const db = memoryDb();
  await migrate(db);
  await db.run(`INSERT INTO transactions (id, kind, name, amount_minor, occurred_on) VALUES ('a','expense','x',100,'2026-11-01')`);
  const bucketFor = async (weekStart: number) => (await insights(db, { from: '2026-01-01', to: '2026-12-31', gran: 'week', weekStart })).series[0].bucket;
  assert.equal(await bucketFor(1), '2026-10-26'); // Monday start
  assert.equal(await bucketFor(7), '2026-11-01'); // Sunday start
  assert.equal(await bucketFor(6), '2026-10-31'); // Saturday start
  assert.equal(await bucketFor(2), '2026-10-27'); // Tuesday start
});

test('money stays exact and LIKE wildcards in search are literal', async () => {
  const db = memoryDb();
  await migrate(db);
  for (const [i, minor] of [10, 20, 30].entries()) {
    await db.run(`INSERT INTO transactions (id, kind, name, amount_minor, occurred_on) VALUES (?,?,?,?,?)`, [`m${i}`, 'expense', i === 0 ? '50% off' : 'plain', minor, '2026-05-05']);
  }
  const all = await insights(db, { from: '2026-01-01', to: '2026-12-31' });
  assert.equal(all.totals.spent, 0.6); // 0.1 + 0.2 + 0.3 without float drift
  const pct = await insights(db, { from: '2026-01-01', to: '2026-12-31', q: '%' });
  assert.equal(pct.totals.count, 1); // only the row that really contains "%"
  const under = await insights(db, { from: '2026-01-01', to: '2026-12-31', q: '_' });
  assert.equal(under.totals.count, 0);
});

test('SQL injection attempts in filters are inert', async () => {
  const { db } = await seed(50, 5);
  const evil = `'; DROP TABLE transactions; --`;
  await insights(db, { from: '2024-01-01', to: '2026-12-31', q: evil, category: evil, bank: evil, kind: 'expense' });
  const left = await db.all<{ n: number }>('SELECT count(*) AS n FROM transactions');
  assert.ok(left[0].n === 50);
  await assert.rejects(() => insights(db, { from: `2024-01-01'; DROP TABLE x;--`, to: '2026-12-31' }), /Invalid date range/);
  await assert.rejects(() => insights(db, { from: '2024-01-01', to: '2026-12-31', gran: 'week', weekStart: 9 }), /Invalid week start/);
});

test('empty ranges return empty, well-shaped results', async () => {
  const db = memoryDb();
  await migrate(db);
  const r = await insights(db, { from: '2026-01-01', to: '2026-01-31', gran: 'week' });
  assert.equal(r.totals.spent, 0);
  assert.equal(r.totals.biggest, null);
  for (const k of ['series', 'monthly', 'by_category', 'by_source', 'by_bank', 'by_mode', 'need_want', 'nw_series', 'top', 'daily', 'dow'] as const) {
    assert.deepEqual(r[k], [], k);
  }
});
