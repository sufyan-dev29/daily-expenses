'use client';
import { localDb } from '@/lib/local/client';
import { requestSync } from '@/lib/local/sync';
import type { Transaction } from '@/lib/types';

export const TX_COLUMNS =
  'id,kind,name,amount,occurred_on,category_id,bank_id,payment_mode_id,income_source_id,need_want,notes,deleted_at,created_at';

export type TxInput = Pick<
  Transaction,
  'id' | 'kind' | 'name' | 'amount' | 'occurred_on' | 'category_id' | 'bank_id' | 'payment_mode_id' | 'income_source_id' | 'need_want' | 'notes'
>;

type Result = { pending: boolean; error?: string };

/** Insert-or-update by client-generated id. Saved on the phone straight away; the Sheet copy happens in the background. */
export async function saveTx(input: TxInput): Promise<Result> {
  const row = { ...input, notes: input.notes?.trim() || null };
  const { error } = await localDb().from('transactions').upsert(row, { onConflict: 'id' });
  if (error) return { pending: false, error: error.message };
  requestSync('change');
  return { pending: false };
}

export async function trashTx(id: string): Promise<Result> {
  const { error } = await localDb().from('transactions').update({ deleted_at: new Date().toISOString() }).eq('id', id);
  if (error) return { pending: false, error: error.message };
  requestSync('change');
  return { pending: false };
}

export async function restoreTx(id: string): Promise<Result> {
  const { error } = await localDb().from('transactions').update({ deleted_at: null }).eq('id', id);
  if (error) return { pending: false, error: error.message };
  requestSync('change');
  return { pending: false };
}

export async function deleteForever(id: string) {
  const r = await localDb().from('transactions').delete().eq('id', id);
  requestSync('change');
  return r;
}

export function triggerSheetSync() { requestSync('change'); }
