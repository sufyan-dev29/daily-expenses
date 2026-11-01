import { NextResponse } from 'next/server';
import { isCronAuthorized } from '@/lib/guards';
import { supabaseAdmin } from '@/lib/supabase/server';
import { drainOutbox, recordSyncResult } from '@/lib/sheets';
import type { SheetConfig } from '@/lib/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// Daily: purge expired trash, retry failed sheet syncs.
export async function GET(req: Request) {
  if (!isCronAuthorized(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const admin = supabaseAdmin();
  const { data: users } = await admin.from('user_settings').select('user_id, trash_retention_days, sheet');

  let purged = 0;
  const sync: Record<string, unknown> = {};
  for (const u of users ?? []) {
    const cutoff = new Date(Date.now() - u.trash_retention_days * 86_400_000).toISOString();
    const { count } = await admin
      .from('transactions')
      .delete({ count: 'exact' })
      .eq('user_id', u.user_id)
      .not('deleted_at', 'is', null)
      .lt('deleted_at', cutoff);
    purged += count ?? 0;

    const cfg = u.sheet as SheetConfig | null;
    if (cfg?.spreadsheetId) {
      try {
        // make failed jobs due again once a day
        await admin.from('sync_outbox').update({ next_attempt_at: new Date().toISOString() }).eq('user_id', u.user_id);
        const r = await drainOutbox(u.user_id, cfg, 200);
        await recordSyncResult(u.user_id, cfg, r.failed ? r.lastError : null);
        sync[u.user_id] = r;
      } catch (e) {
        await recordSyncResult(u.user_id, cfg, (e as Error).message);
      }
    }
  }
  return NextResponse.json({ ok: true, purged, sync });
}
