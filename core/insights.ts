import type { SqlDb, SqlValue } from './db.ts';
import { one } from './db.ts';
import { fromMinor } from './money.ts';

export type Gran = 'day' | 'week' | 'month' | 'year';

export interface InsightsParams {
  from: string; // YYYY-MM-DD, inclusive
  to: string; // YYYY-MM-DD, inclusive
  gran?: Gran;
  kind?: '' | 'expense' | 'income' | null;
  category?: string | null;
  bank?: string | null;
  mode?: string | null;
  needWant?: '' | 'need' | 'want' | null;
  source?: string | null;
  /** Amounts in major units (e.g. rupees), converted internally. */
  min?: number | null;
  max?: number | null;
  q?: string | null;
  weekStart?: number; // 1 = Monday ... 7 = Sunday
}

export interface InsightsResult {
  totals: { spent: number; income: number; count: number; expense_count: number; biggest: { name: string; amount: number } | null };
  series: { bucket: string; expense: number; income: number; count: number }[];
  monthly: { bucket: string; expense: number; income: number }[];
  by_category: { id: string | null; name: string; color: string | null; total: number; count: number }[];
  by_source: { id: string | null; name: string; color: string | null; total: number; count: number }[];
  by_bank: { id: string | null; name: string; expense: number; income: number }[];
  by_mode: { id: string | null; name: string; expense: number; income: number }[];
  need_want: { key: 'need' | 'want' | 'unspecified'; total: number; count: number }[];
  nw_series: { bucket: string; need: number; want: number; unspecified: number }[];
  top: { id: string; name: string; amount: number; occurred_on: string; category: string | null }[];
  daily: { day: string; total: number }[];
  dow: { dow: number; total: number; days: number }[];
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** SQL that maps a YYYY-MM-DD column to the first day of its day/week/month/year bucket. */
export function bucketSql(col: string, gran: Gran, weekStart: number): string {
  const ws = Math.trunc(weekStart);
  if (!(ws >= 1 && ws <= 7)) throw new Error('Invalid week start');
  switch (gran) {
    case 'month':
      return `(substr(${col}, 1, 7) || '-01')`;
    case 'year':
      return `(substr(${col}, 1, 4) || '-01-01')`;
    case 'week':
      // strftime %w: 0 = Sunday. isodow = ((w + 6) % 7) + 1. Days back to the chosen first weekday.
      return `date(${col}, '-' || ((((CAST(strftime('%w', ${col}) AS INTEGER) + 6) % 7) + 1 - ${ws} + 7) % 7) || ' days')`;
    default:
      return col;
  }
}

function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, (m) => '\\' + m);
}

export async function insights(db: SqlDb, p: InsightsParams): Promise<InsightsResult> {
  if (!DATE.test(p.from) || !DATE.test(p.to)) throw new Error('Invalid date range');
  const gran: Gran = p.gran ?? 'day';
  const ws = p.weekStart ?? 1;

  const where: string[] = ['deleted_at IS NULL', 'occurred_on BETWEEN ? AND ?'];
  const params: SqlValue[] = [p.from, p.to];
  const add = (cond: string, ...vals: SqlValue[]) => {
    where.push(cond);
    params.push(...vals);
  };
  if (p.kind) add('kind = ?', p.kind);
  if (p.category) add('category_id = ?', p.category);
  if (p.bank) add('bank_id = ?', p.bank);
  if (p.mode) add('payment_mode_id = ?', p.mode);
  if (p.needWant) add('need_want = ?', p.needWant);
  if (p.source) add('income_source_id = ?', p.source);
  if (p.min !== null && p.min !== undefined) add('amount_minor >= ?', Math.round(p.min * 100));
  if (p.max !== null && p.max !== undefined) add('amount_minor <= ?', Math.round(p.max * 100));
  if (p.q) {
    const like = `%${escapeLike(p.q)}%`;
    add(`(name LIKE ? ESCAPE '\\' OR coalesce(notes, '') LIKE ? ESCAPE '\\')`, like, like);
  }

  const cte = `WITH f AS (SELECT id, kind, name, amount_minor, occurred_on, category_id, bank_id, payment_mode_id, income_source_id, need_want, created_at FROM transactions WHERE ${where.join(' AND ')})`;
  const q = <T>(sql: string) => db.all<T>(`${cte} ${sql}`, params);
  const bucket = bucketSql('occurred_on', gran, ws);
  const monthBucket = bucketSql('occurred_on', 'month', ws);
  const E = `coalesce(sum(CASE WHEN kind = 'expense' THEN amount_minor END), 0)`;
  const I = `coalesce(sum(CASE WHEN kind = 'income' THEN amount_minor END), 0)`;

  const [totals] = await q<{ spent: number; income: number; count: number; expense_count: number }>(
    `SELECT ${E} AS spent, ${I} AS income, count(*) AS count, coalesce(sum(kind = 'expense'), 0) AS expense_count FROM f`,
  );
  const biggest = (await q<{ name: string; amount_minor: number }>(
    `SELECT name, amount_minor FROM f WHERE kind = 'expense' ORDER BY amount_minor DESC, occurred_on DESC, created_at DESC, id LIMIT 1`,
  ))[0];

  const series = await q<{ bucket: string; expense: number; income: number; count: number }>(
    `SELECT ${bucket} AS bucket, ${E} AS expense, ${I} AS income, count(*) AS count FROM f GROUP BY 1 ORDER BY 1`,
  );
  const monthly = await q<{ bucket: string; expense: number; income: number }>(
    `SELECT ${monthBucket} AS bucket, ${E} AS expense, ${I} AS income FROM f GROUP BY 1 ORDER BY 1`,
  );
  const byCategory = await q<{ id: string | null; name: string; color: string | null; total: number; count: number }>(
    `SELECT o.id AS id, coalesce(o.name, 'Uncategorized') AS name, o.color AS color, sum(f.amount_minor) AS total, count(*) AS count
       FROM f LEFT JOIN options o ON o.id = f.category_id WHERE f.kind = 'expense'
       GROUP BY o.id ORDER BY total DESC, name, o.id`,
  );
  const bySource = await q<{ id: string | null; name: string; color: string | null; total: number; count: number }>(
    `SELECT o.id AS id, coalesce(o.name, 'Unspecified') AS name, o.color AS color, sum(f.amount_minor) AS total, count(*) AS count
       FROM f LEFT JOIN options o ON o.id = f.income_source_id WHERE f.kind = 'income'
       GROUP BY o.id ORDER BY total DESC, name, o.id`,
  );
  const split = (col: string) =>
    q<{ id: string | null; name: string; expense: number; income: number }>(
      `SELECT o.id AS id, coalesce(o.name, 'Unspecified') AS name,
              coalesce(sum(CASE WHEN f.kind = 'expense' THEN f.amount_minor END), 0) AS expense,
              coalesce(sum(CASE WHEN f.kind = 'income' THEN f.amount_minor END), 0) AS income
         FROM f LEFT JOIN options o ON o.id = f.${col}
         GROUP BY o.id ORDER BY (expense + income) DESC, name, o.id`,
    );
  const [byBank, byMode] = [await split('bank_id'), await split('payment_mode_id')];
  const needWant = await q<{ key: 'need' | 'want' | 'unspecified'; total: number; count: number }>(
    `SELECT coalesce(need_want, 'unspecified') AS key, sum(amount_minor) AS total, count(*) AS count
       FROM f WHERE kind = 'expense' GROUP BY 1 ORDER BY 1`,
  );
  const nwSeries = await q<{ bucket: string; need: number; want: number; unspecified: number }>(
    `SELECT ${bucket} AS bucket,
            coalesce(sum(CASE WHEN need_want = 'need' THEN amount_minor END), 0) AS need,
            coalesce(sum(CASE WHEN need_want = 'want' THEN amount_minor END), 0) AS want,
            coalesce(sum(CASE WHEN need_want IS NULL THEN amount_minor END), 0) AS unspecified
       FROM f WHERE kind = 'expense' GROUP BY 1 ORDER BY 1`,
  );
  const top = await q<{ id: string; name: string; amount_minor: number; occurred_on: string; category: string | null }>(
    `SELECT f.id AS id, f.name AS name, f.amount_minor AS amount_minor, f.occurred_on AS occurred_on, o.name AS category
       FROM f LEFT JOIN options o ON o.id = f.category_id WHERE f.kind = 'expense'
       ORDER BY f.amount_minor DESC, f.occurred_on DESC, f.id LIMIT 10`,
  );
  const daily = await q<{ day: string; total: number }>(
    `SELECT occurred_on AS day, sum(amount_minor) AS total FROM f WHERE kind = 'expense' GROUP BY 1 ORDER BY 1`,
  );
  const dow = await q<{ dow: number; total: number; days: number }>(
    `SELECT ((CAST(strftime('%w', occurred_on) AS INTEGER) + 6) % 7) + 1 AS dow, sum(amount_minor) AS total, count(DISTINCT occurred_on) AS days
       FROM f WHERE kind = 'expense' GROUP BY 1 ORDER BY 1`,
  );

  const m = fromMinor;
  return {
    totals: {
      spent: m(totals.spent),
      income: m(totals.income),
      count: totals.count,
      expense_count: totals.expense_count,
      biggest: biggest ? { name: biggest.name, amount: m(biggest.amount_minor) } : null,
    },
    series: series.map((r) => ({ bucket: r.bucket, expense: m(r.expense), income: m(r.income), count: r.count })),
    monthly: monthly.map((r) => ({ bucket: r.bucket, expense: m(r.expense), income: m(r.income) })),
    by_category: byCategory.map((r) => ({ ...r, total: m(r.total) })),
    by_source: bySource.map((r) => ({ ...r, total: m(r.total) })),
    by_bank: byBank.map((r) => ({ ...r, expense: m(r.expense), income: m(r.income) })),
    by_mode: byMode.map((r) => ({ ...r, expense: m(r.expense), income: m(r.income) })),
    need_want: needWant.map((r) => ({ ...r, total: m(r.total) })),
    nw_series: nwSeries.map((r) => ({ bucket: r.bucket, need: m(r.need), want: m(r.want), unspecified: m(r.unspecified) })),
    top: top.map((r) => ({ id: r.id, name: r.name, amount: m(r.amount_minor), occurred_on: r.occurred_on, category: r.category })),
    daily: daily.map((r) => ({ day: r.day, total: m(r.total) })),
    dow: dow.map((r) => ({ dow: r.dow, total: m(r.total), days: r.days })),
  };
}

/** Unused-import guard for `one` in builds that tree-shake aggressively. */
export const _one = one;
