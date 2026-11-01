'use client';
import { supabaseBrowser } from '@/lib/supabase/browser';
import { enqueue, isNetworkError } from '@/lib/offline';
import type { Transaction } from '@/lib/types';

export const TX_COLUMNS =
  'id,kind,name,amount,occurred_on,category_id,bank_id,payment_mode_id,income_source_id,need_want,notes,deleted_at,created_at';

export type TxInput = Pick<
  Transaction,
  'id' | 'kind' | 'name' | 'amount' | 'occurred_on' | 'category_id' | 'bank_id' | 'payment_mode_id' | 'income_source_id' | 'need_want' | 'notes'
>;

/** Insert-or-update by client-generated id (idempotent, so offline replays are safe). */
export async function saveTx(input: TxInput): Promise<{ pending: boolean; error?: string }> {
  const row = { ...input, notes: input.notes?.trim() || null };
  try {
    const { error } = await supabaseBrowser().from('transactions').upsert(row, { onConflict: 'id' });
    if (error) {
      if (isNetworkError(error)) throw error;
      return { pending: false, error: error.message };
    }
    triggerSheetSync();
    return { pending: false };
  } catch (e) {
    if (isNetworkError(e)) {
      await enqueue({ op: 'upsert', id: input.id, row });
      return { pending: true };
    }
    return { pending: false, error: (e as Error).message };
  }
}

export async function trashTx(id: string): Promise<{ pending: boolean; error?: string }> {
  try {
    const { error } = await supabaseBrowser().from('transactions').update({ deleted_at: new Date().toISOString() }).eq('id', id);
    if (error) throw error;
    triggerSheetSync();
    return { pending: false };
  } catch (e) {
    if (isNetworkError(e)) {
      await enqueue({ op: 'trash', id });
      return { pending: true };
    }
    return { pending: false, error: (e as Error).message };
  }
}

export async function restoreTx(id: string): Promise<{ pending: boolean; error?: string }> {
  try {
    const { error } = await supabaseBrowser().from('transactions').update({ deleted_at: null }).eq('id', id);
    if (error) throw error;
    triggerSheetSync();
    return { pending: false };
  } catch (e) {
    if (isNetworkError(e)) {
      await enqueue({ op: 'restore', id });
      return { pending: true };
    }
    return { pending: false, error: (e as Error).message };
  }
}

export async function deleteForever(id: string) {
  return supabaseBrowser().from('transactions').delete().eq('id', id);
}

// Debounced, fire-and-forget: pushes the outbox to Google Sheets. Silent when no sheet is configured.
let t: ReturnType<typeof setTimeout> | undefined;
export function triggerSheetSync() {
  clearTimeout(t);
  t = setTimeout(() => {
    fetch('/api/sheet', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mode: 'now' }) })
      .then(() => window.dispatchEvent(new Event('et-sheet-sync')))
      .catch(() => {});
  }, 2500);
}
