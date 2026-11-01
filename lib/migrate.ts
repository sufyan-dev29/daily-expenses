import 'server-only';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { Client } from 'pg';

function dir() {
  return path.join(process.cwd(), 'supabase', 'migrations');
}

export function pgClient() {
  return new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 10_000,
  });
}

export async function checkDb(): Promise<void> {
  const c = pgClient();
  await c.connect();
  try {
    await c.query('select 1');
  } finally {
    await c.end();
  }
}

/** Runs any migration file not yet recorded in public._migrations. Each file runs in a transaction. */
export async function runMigrations(): Promise<string[]> {
  const files = (await readdir(dir())).filter((f) => f.endsWith('.sql')).sort();
  const c = pgClient();
  await c.connect();
  const applied: string[] = [];
  try {
    await c.query(
      'create table if not exists public._migrations (name text primary key, applied_at timestamptz not null default now())',
    );
    await c.query('alter table public._migrations enable row level security');
    const done = new Set((await c.query('select name from public._migrations')).rows.map((r) => r.name as string));
    for (const f of files) {
      if (done.has(f)) continue;
      const sql = await readFile(path.join(dir(), f), 'utf8');
      try {
        await c.query('begin');
        await c.query(sql);
        await c.query('insert into public._migrations (name) values ($1)', [f]);
        await c.query('commit');
        applied.push(f);
      } catch (e) {
        await c.query('rollback');
        throw new Error(`Migration ${f} failed: ${(e as Error).message}`);
      }
    }
  } finally {
    await c.end();
  }
  return applied;
}

export async function ownerExists(): Promise<boolean> {
  const c = pgClient();
  await c.connect();
  try {
    const t = await c.query("select to_regclass('public.profiles') as t");
    if (!t.rows[0].t) return false;
    const r = await c.query('select 1 from public.profiles limit 1');
    return r.rowCount! > 0;
  } finally {
    await c.end();
  }
}
