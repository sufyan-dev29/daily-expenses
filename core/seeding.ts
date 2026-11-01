import type { SqlDb } from './db.ts';
import { uuid } from './uuid.ts';
import { STARTER_OPTIONS, defaultIconFor } from '../lib/seed.ts';

/** Starter lists for a new account (all editable or archivable later). Only runs when the account has no lists yet. */
export async function seedStarterOptions(db: SqlDb): Promise<number> {
  const have = (await db.all<{ n: number }>('SELECT count(*) AS n FROM options'))[0].n;
  if (have > 0) return 0;
  const rows: (string | number | null)[][] = [];
  for (const kind of Object.keys(STARTER_OPTIONS) as (keyof typeof STARTER_OPTIONS)[]) {
    STARTER_OPTIONS[kind].forEach((name, i) => rows.push([uuid(), kind, name, i, kind === 'category' || kind === 'income_source' ? defaultIconFor(name) : null]));
  }
  await db.transaction(async () => { await db.runMany('INSERT INTO options (id, kind, name, sort_order, icon) VALUES (?,?,?,?,?)', rows); });
  return rows.length;
}
