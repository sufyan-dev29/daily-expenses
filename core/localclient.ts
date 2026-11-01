/**
 * A small Supabase/PostgREST-shaped query layer over the on-device SQLite database.
 * The screens were written against `supabase.from(...).select().eq()...`; keeping that call shape means the UI code
 * (and so its look and behaviour) does not change. Only whitelisted table and column names ever reach the SQL text;
 * every value is a bound parameter.
 */
import type { SqlDb, SqlValue } from './db.ts';
import { fromMinor, toMinor } from './money.ts';
import { insights, type InsightsParams } from './insights.ts';
import { uuid } from './uuid.ts';

export interface LocalError { message: string; code?: string }
export interface LocalResult<T = any> { data: T | null; error: LocalError | null; count?: number | null }

type ColSpec = { sql: string; json?: boolean; money?: boolean; writable?: boolean };
interface TableSpec { table: string; cols: Record<string, ColSpec>; defaults?: () => Record<string, SqlValue>; touch?: boolean; single?: boolean }

const plain = (names: string[]): Record<string, ColSpec> => Object.fromEntries(names.map((n) => [n, { sql: n }]));

const TABLES: Record<string, TableSpec> = {
  transactions: {
    table: 'transactions', touch: true,
    cols: { ...plain(['id', 'kind', 'name', 'occurred_on', 'category_id', 'bank_id', 'payment_mode_id', 'income_source_id', 'need_want', 'notes', 'deleted_at', 'created_at', 'updated_at']), amount: { sql: 'amount_minor', money: true } },
    defaults: () => ({ id: uuid() }),
  },
  options: { table: 'options', cols: plain(['id', 'kind', 'name', 'sort_order', 'color', 'icon', 'archived_at', 'created_at']), defaults: () => ({ id: uuid() }) },
  templates: {
    table: 'templates',
    cols: { ...plain(['id', 'kind', 'name', 'behavior', 'sort_order', 'created_at']), payload: { sql: 'payload', json: true } },
    defaults: () => ({ id: uuid() }),
  },
  user_settings: {
    table: 'settings', single: true, touch: true,
    cols: { ...plain(['mode', 'theme_mode', 'accent_hex', 'currency', 'locale', 'date_format', 'week_start', 'timezone', 'trash_retention_days', 'updated_at']), remember_last: { sql: 'remember_last', json: true }, sheet: { sql: 'sheet', json: true } },
  },
};

type Filter = { col: string; op: string; val?: unknown };

function toError(e: unknown): LocalError {
  const msg = String((e as any)?.message ?? e);
  if (/UNIQUE constraint failed/i.test(msg)) return { message: 'duplicate key value violates unique constraint', code: '23505' };
  if (/CHECK constraint failed|NOT NULL constraint failed|FOREIGN KEY constraint failed/i.test(msg)) return { message: msg.replace(/^.*?(constraint failed)/i, 'Invalid value ($1)'), code: '23514' };
  return { message: msg };
}

export class LocalQuery implements PromiseLike<LocalResult> {
  private spec: TableSpec;
  private op: 'select' | 'insert' | 'update' | 'delete' | 'upsert' = 'select';
  private filters: Filter[] = [];
  private orders: { col: string; asc: boolean }[] = [];
  private from_: number | null = null;
  private to_: number | null = null;
  private limit_: number | null = null;
  private mode: 'many' | 'single' | 'maybe' = 'many';
  private cols: string[] | null = null; // null = *
  private wantCount = false;
  private returning = false;
  private payload: Record<string, unknown>[] = [];
  private conflict = 'id';

  private db: SqlDb;
  constructor(db: SqlDb, name: string) {
    this.db = db;
    const spec = TABLES[name];
    if (!spec) throw new Error(`Unknown table: ${name}`);
    this.spec = spec;
  }

  select(columns = '*', opts?: { count?: 'exact' }) {
    if (this.op === 'select') { this.cols = parseCols(columns); this.wantCount = opts?.count === 'exact'; }
    else { this.returning = true; this.cols = parseCols(columns); }
    return this;
  }
  insert(row: Record<string, unknown> | Record<string, unknown>[]) { this.op = 'insert'; this.payload = Array.isArray(row) ? row : [row]; return this; }
  upsert(row: Record<string, unknown> | Record<string, unknown>[], opts?: { onConflict?: string }) { this.op = 'upsert'; this.payload = Array.isArray(row) ? row : [row]; if (opts?.onConflict) this.conflict = opts.onConflict; return this; }
  update(patch: Record<string, unknown>) { this.op = 'update'; this.payload = [patch]; return this; }
  delete() { this.op = 'delete'; return this; }

  eq(col: string, val: unknown) { return this.f(col, 'eq', val); }
  neq(col: string, val: unknown) { return this.f(col, 'neq', val); }
  is(col: string, val: null) { return this.f(col, 'is', val); }
  not(col: string, op: string, val: unknown) { return this.f(col, 'not' + op, val); }
  gte(col: string, val: unknown) { return this.f(col, 'gte', val); }
  lte(col: string, val: unknown) { return this.f(col, 'lte', val); }
  gt(col: string, val: unknown) { return this.f(col, 'gt', val); }
  lt(col: string, val: unknown) { return this.f(col, 'lt', val); }
  in(col: string, vals: unknown[]) { return this.f(col, 'in', vals); }
  ilike(col: string, pattern: string) { return this.f(col, 'ilike', pattern); }
  order(col: string, opts?: { ascending?: boolean }) { this.orders.push({ col, asc: opts?.ascending !== false }); return this; }
  range(from: number, to: number) { this.from_ = from; this.to_ = to; return this; }
  limit(n: number) { this.limit_ = n; return this; }
  single() { this.mode = 'single'; return this; }
  maybeSingle() { this.mode = 'maybe'; return this; }

  private f(col: string, op: string, val?: unknown) { this.filters.push({ col, op, val }); return this; }

  private col(name: string): ColSpec {
    const c = this.spec.cols[name];
    if (!c) throw new Error(`Unknown column: ${name}`);
    return c;
  }

  private where(): { sql: string; params: SqlValue[] } {
    const parts: string[] = []; const params: SqlValue[] = [];
    for (const { col, op, val } of this.filters) {
      const c = this.col(col);
      const conv = (v: unknown): SqlValue => (c.money ? toMinor(Number(v)) : (v as SqlValue));
      switch (op) {
        case 'eq': if (val === null) parts.push(`${c.sql} IS NULL`); else { parts.push(`${c.sql} = ?`); params.push(conv(val)); } break;
        case 'neq': if (val === null) parts.push(`${c.sql} IS NOT NULL`); else { parts.push(`${c.sql} IS NOT ?`); params.push(conv(val)); } break;
        case 'is': parts.push(`${c.sql} IS NULL`); break;
        case 'notis': parts.push(`${c.sql} IS NOT NULL`); break;
        case 'gte': parts.push(`${c.sql} >= ?`); params.push(conv(val)); break;
        case 'lte': parts.push(`${c.sql} <= ?`); params.push(conv(val)); break;
        case 'gt': parts.push(`${c.sql} > ?`); params.push(conv(val)); break;
        case 'lt': parts.push(`${c.sql} < ?`); params.push(conv(val)); break;
        case 'in': { const a = (val as unknown[]) ?? []; if (!a.length) parts.push('0'); else { parts.push(`${c.sql} IN (${a.map(() => '?').join(',')})`); params.push(...a.map(conv)); } break; }
        case 'ilike': parts.push(`${c.sql} LIKE ? ESCAPE '\\'`); params.push(String(val)); break;
        default: throw new Error(`Unsupported filter: ${op}`);
      }
    }
    return { sql: parts.length ? ' WHERE ' + parts.join(' AND ') : '', params };
  }

  private selectList(): string {
    const names = this.cols ?? Object.keys(this.spec.cols);
    return names.map((n) => `${this.col(n).sql} AS ${n}`).join(', ');
  }

  private shape(row: Record<string, any>): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(row)) {
      const c = this.spec.cols[k];
      if (!c) continue;
      if (c.money) out[k] = v === null ? null : fromMinor(v as number);
      else if (c.json) { try { out[k] = v === null ? null : JSON.parse(v as string); } catch { out[k] = null; } }
      else out[k] = v;
    }
    return out;
  }

  private writeRow(input: Record<string, unknown>, creating: boolean): { names: string[]; vals: SqlValue[] } {
    const row = { ...(creating ? this.spec.defaults?.() : {}), ...input };
    const names: string[] = []; const vals: SqlValue[] = [];
    for (const [k, v] of Object.entries(row)) {
      if (v === undefined) continue;
      const c = this.col(k);
      if (this.spec.single && k === 'updated_at') continue;
      names.push(c.sql);
      vals.push(c.money ? (v === null ? null : toMinor(Number(v))) : c.json ? (v === null ? null : JSON.stringify(v)) : (v as SqlValue));
    }
    return { names, vals };
  }

  private async run(): Promise<LocalResult> {
    const { spec, db } = this;
    const T = spec.table;
    let ids: string[] | null = null;
    let affected = 0;

    if (this.op === 'select') {
      const w = this.where();
      let sql = `SELECT ${this.selectList()} FROM ${T}${spec.single ? ' WHERE id = 1' + (w.sql ? ' AND ' + w.sql.slice(7) : '') : w.sql}`;
      const order = this.orders.map((o) => `${this.col(o.col).sql} ${o.asc ? 'ASC' : 'DESC'}`);
      if (order.length) sql += ' ORDER BY ' + order.join(', ');
      let count: number | null = null;
      if (this.wantCount) count = (await db.all<{ n: number }>(`SELECT count(*) AS n FROM ${T}${spec.single ? ' WHERE id = 1' : w.sql}`, spec.single ? [] : w.params))[0].n;
      const params = [...w.params];
      if (this.from_ !== null && this.to_ !== null) { sql += ' LIMIT ? OFFSET ?'; params.push(Math.max(0, this.to_ - this.from_ + 1), Math.max(0, this.from_)); }
      else if (this.limit_ !== null) { sql += ' LIMIT ?'; params.push(this.limit_); }
      const rows = (await db.all<Record<string, unknown>>(sql, params)).map((r) => this.shape(r));
      return this.finish(rows, count);
    }

    if (spec.single && this.op !== 'update') throw new Error('Settings can only be updated');

    await db.transaction(async () => {
      if (this.op === 'insert' || this.op === 'upsert') {
        ids = [];
        for (const input of this.payload) {
          const { names, vals } = this.writeRow(input, true);
          const idIdx = names.indexOf('id');
          let sql = `INSERT INTO ${T} (${names.join(',')}) VALUES (${names.map(() => '?').join(',')})`;
          if (this.op === 'upsert') {
            const keep = names.filter((n) => n !== 'id' && n !== 'created_at');
            sql += keep.length ? ` ON CONFLICT(id) DO UPDATE SET ${keep.map((n) => `${n} = excluded.${n}`).join(', ')}${spec.touch ? ", updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')" : ''}` : ' ON CONFLICT(id) DO NOTHING';
          }
          const r = await db.run(sql, vals);
          affected += r.changes;
          if (idIdx >= 0) ids.push(String(vals[idIdx]));
        }
      } else if (this.op === 'update') {
        const { names, vals } = this.writeRow(this.payload[0], false);
        if (!names.length) return;
        const w = this.where();
        const set = names.map((n) => `${n} = ?`).join(', ') + (spec.touch && !names.includes('updated_at') ? ", updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')" : '');
        if (this.returning) ids = (await db.all<{ id: string }>(`SELECT ${spec.single ? '1' : 'id'} AS id FROM ${T}${spec.single ? ' WHERE id = 1' : w.sql}`, spec.single ? [] : w.params)).map((r) => String(r.id));
        const r = await db.run(`UPDATE ${T} SET ${set}${spec.single ? ' WHERE id = 1' : w.sql}`, [...vals, ...(spec.single ? [] : w.params)]);
        affected = r.changes;
      } else {
        const w = this.where();
        if (!w.sql) throw new Error('Refusing to delete without a filter');
        affected = (await db.run(`DELETE FROM ${T}${w.sql}`, w.params)).changes;
      }
    });

    if (!this.returning) return { data: null, error: null };
    if (ids && ids.length && this.op !== 'delete') {
      const sel = await db.all<Record<string, unknown>>(`SELECT ${this.selectList()} FROM ${T} WHERE ${spec.single ? 'id = 1' : `id IN (${ids.map(() => '?').join(',')})`}`, spec.single ? [] : ids);
      return this.finish(sel.map((r) => this.shape(r)), null);
    }
    void affected;
    return this.finish([], null);
  }

  private finish(rows: Record<string, unknown>[], count: number | null): LocalResult {
    if (this.mode === 'many') return { data: rows, error: null, count };
    if (this.mode === 'single' && rows.length !== 1) return { data: null, error: { message: 'JSON object requested, multiple (or no) rows returned', code: 'PGRST116' }, count };
    return { data: rows[0] ?? null, error: null, count };
  }

  then<A = LocalResult, B = never>(ok?: ((v: LocalResult) => A | PromiseLike<A>) | null, bad?: ((e: unknown) => B | PromiseLike<B>) | null): PromiseLike<A | B> {
    return this.run().catch((e): LocalResult => ({ data: null, error: toError(e) })).then(ok, bad);
  }
}

export interface LocalClient {
  from(table: string): LocalQuery;
  rpc(name: string, args: Record<string, any>): Promise<LocalResult>;
}

export function localClient(db: SqlDb): LocalClient {
  return {
    from: (table) => new LocalQuery(db, table),
    async rpc(name, a) {
      if (name !== 'insights') return { data: null, error: { message: `Unknown function: ${name}` } };
      try {
        const p: InsightsParams = { from: a.p_from, to: a.p_to, gran: a.p_gran, kind: a.p_kind, category: a.p_category, bank: a.p_bank, mode: a.p_mode, needWant: a.p_need_want, source: a.p_source, min: a.p_min, max: a.p_max, q: a.p_q, weekStart: a.p_week_start };
        return { data: await insights(db, p), error: null };
      } catch (e) { return { data: null, error: toError(e) }; }
    },
  };
}

function parseCols(s: string): string[] | null {
  const t = s.trim();
  if (t === '*' || t === '') return null;
  return t.split(',').map((x) => x.trim()).filter(Boolean);
}
