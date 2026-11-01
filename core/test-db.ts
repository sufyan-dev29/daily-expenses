/** node:sqlite adapter for tests only. */
import { DatabaseSync } from 'node:sqlite';
import type { SqlDb, SqlValue } from './db.ts';

export function memoryDb(): SqlDb & { raw: DatabaseSync } {
  const raw = new DatabaseSync(':memory:');
  raw.exec('PRAGMA foreign_keys = ON;');
  let depth = 0;
  return {
    raw,
    async run(sql: string, params: SqlValue[] = []) {
      const r = raw.prepare(sql).run(...params);
      return { changes: Number(r.changes) };
    },
    async runMany(sql: string, sets: SqlValue[][]) {
      const st = raw.prepare(sql);
      for (const params of sets) st.run(...params);
    },
    async all<T>(sql: string, params: SqlValue[] = []) {
      return raw.prepare(sql).all(...params).map((r) => ({ ...r })) as T[];
    },
    async exec(sql: string) {
      raw.exec(sql);
    },
    async transaction<T>(fn: () => Promise<T>) {
      if (depth > 0) throw new Error('nested transaction');
      depth++;
      raw.exec('BEGIN');
      try {
        const out = await fn();
        raw.exec('COMMIT');
        return out;
      } catch (e) {
        raw.exec('ROLLBACK');
        throw e;
      } finally {
        depth--;
      }
    },
  };
}
