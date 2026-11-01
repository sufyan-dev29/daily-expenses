'use client';
import { openDB, type DBSchema } from 'idb';
import { supabaseBrowser } from '@/lib/supabase/browser';
import type { Transaction } from '@/lib/types';

type TxRow = Omit<Transaction, 'deleted_at' | 'created_at' | 'pending' | 'updated_at'>;

interface QueueItem {
  seq?: number;
  op: 'upsert' | 'trash' | 'restore';
  id: string;
  row?: TxRow;
  at: string;
}

interface Schema extends DBSchema {
  queue: { key: number; value: QueueItem };
}

const db = () =>
  openDB<Schema>('expense-tracker', 1, {
    upgrade(d) {
      d.createObjectStore('queue', { keyPath: 'seq', autoIncrement: true });
    },
  });

export async function enqueue(item: Omit<QueueItem, 'seq' | 'at'>) {
  await (await db()).add('queue', { ...item, at: new Date().toISOString() });
  window.dispatchEvent(new Event('et-queue'));
}

export async function pendingIds(): Promise<Set<string>> {
  const all = await (await db()).getAll('queue');
  return new Set(all.map((q) => q.id));
}

export async function pendingCount(): Promise<number> {
  return (await db()).count('queue');
}

export function isNetworkError(e: unknown): boolean {
  if (typeof navigator !== 'undefined' && !navigator.onLine) return true;
  const m = String((e as { message?: string })?.message ?? e);
  return /failed to fetch|networkerror|load failed|network request failed/i.test(m);
}

let flushing = false;
/** Pushes queued writes in order. Stops at the first network failure. Returns how many were sent. */
export async function flushQueue(): Promise<number> {
  if (flushing || (typeof navigator !== 'undefined' && !navigator.onLine)) return 0;
  flushing = true;
  let sent = 0;
  try {
    const d = await db();
    const supabase = supabaseBrowser();
    const items = await d.getAll('queue');
    for (const it of items) {
      let err: unknown = null;
      try {
        if (it.op === 'upsert' && it.row) {
          const { error } = await supabase.from('transactions').upsert(it.row, { onConflict: 'id' });
          err = error;
        } else if (it.op === 'trash') {
          const { error } = await supabase.from('transactions').update({ deleted_at: new Date().toISOString() }).eq('id', it.id);
          err = error;
        } else if (it.op === 'restore') {
          const { error } = await supabase.from('transactions').update({ deleted_at: null }).eq('id', it.id);
          err = error;
        }
      } catch (e) {
        err = e;
      }
      if (err && isNetworkError(err)) break;
      // a non-network error (validation, RLS) would block the queue forever: drop it
      await d.delete('queue', it.seq!);
      if (!err) sent++;
    }
  } finally {
    flushing = false;
    window.dispatchEvent(new Event('et-queue'));
  }
  return sent;
}
