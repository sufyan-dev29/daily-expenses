'use client';
import { getDb, hasSession } from '@/lib/local/runtime';
import { requestSync } from '@/lib/local/sync';

/** "Pending" now means: saved on the phone, not yet copied to the Google Sheet (online mode only). */
export async function pendingIds(): Promise<Set<string>> {
  if (!hasSession()) return new Set();
  const rows = await getDb().all<{ transaction_id: string }>('SELECT transaction_id FROM sync_outbox');
  return new Set(rows.map((r) => r.transaction_id));
}

export async function pendingCount(): Promise<number> {
  if (!hasSession()) return 0;
  return (await getDb().all<{ n: number }>('SELECT count(*) AS n FROM sync_outbox'))[0].n;
}

export async function flushQueue(): Promise<number> {
  requestSync('manual');
  return 0;
}
