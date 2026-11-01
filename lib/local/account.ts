'use client';
import { GOOGLE_KEY, NEEDS_FULL_RESYNC, getSecret, setSecret } from '@/core/secrets';
import { getDb, getSession } from '@/lib/local/runtime';
import { store } from '@/lib/local/platform';
import { localDb } from '@/lib/local/client';
import { requestSync } from '@/lib/local/sync';

/** Switches the signed-in account between Offline and Online. */
export async function applyMode(mode: 'offline' | 'online'): Promise<void> {
  const db = getDb();
  const cur = (await db.all<{ mode: string; sheet: string | null }>('SELECT mode, sheet FROM settings WHERE id = 1'))[0];
  // remember each account's mode so the sign-in screen can pre-select it next time
  store.set(`et-mode-${getSession().account.id}`, mode);
  if (!cur || cur.mode === mode) return;
  await localDb().from('user_settings').update({ mode });
  // Changes made while offline were not queued: write the whole sheet once when going online again.
  if (mode === 'online' && cur.sheet && (await getSecret(db, GOOGLE_KEY))) {
    await setSecret(db, NEEDS_FULL_RESYNC, '1');
    requestSync('manual');
  }
}
