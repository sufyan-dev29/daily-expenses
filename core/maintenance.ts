import type { SqlDb } from './db.ts';
import { one } from './db.ts';

/** Permanently removes trashed entries older than the account's retention period. Returns how many were removed. */
export async function purgeTrash(db: SqlDb, nowMs = Date.now()): Promise<number> {
  const s = await one<{ days: number }>(db, 'SELECT trash_retention_days AS days FROM settings WHERE id = 1');
  if (!s) return 0;
  const cutoff = new Date(nowMs - s.days * 86_400_000).toISOString();
  return (await db.run('DELETE FROM transactions WHERE deleted_at IS NOT NULL AND deleted_at < ?', [cutoff])).changes;
}
