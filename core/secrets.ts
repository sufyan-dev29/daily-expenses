import type { SqlDb } from './db.ts';
import { one } from './db.ts';

/** Small key/value store inside the (encrypted) account database. Holds the Google service-account key. */
export async function getSecret(db: SqlDb, key: string): Promise<string | null> {
  return (await one<{ value: string }>(db, 'SELECT value FROM secrets WHERE key = ?', [key]))?.value ?? null;
}
export async function setSecret(db: SqlDb, key: string, value: string): Promise<void> {
  await db.run("INSERT INTO secrets (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')", [key, value]);
}
export async function deleteSecret(db: SqlDb, key: string): Promise<void> {
  await db.run('DELETE FROM secrets WHERE key = ?', [key]);
}
export const GOOGLE_KEY = 'google_sa';
export const NEEDS_FULL_RESYNC = 'needs_full_resync';
