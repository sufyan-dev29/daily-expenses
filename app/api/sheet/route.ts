import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireUser, unauthorized } from '@/lib/guards';
import { sheetConfigSchema } from '@/lib/validation';
import { drainOutbox, fullResync, parseSpreadsheetId, recordSyncResult, testConnection, explain } from '@/lib/sheets';
import type { SheetConfig } from '@/lib/types';

export const runtime = 'nodejs';
export const maxDuration = 60;

// Save link + tab, then test the connection.
export async function PUT(req: Request) {
  const { supabase, user } = await requireUser();
  if (!user) return unauthorized();
  const parsed = sheetConfigSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'Enter the sheet link and tab name.' }, { status: 400 });
  const id = parseSpreadsheetId(parsed.data.url);
  if (!id) return NextResponse.json({ error: 'That does not look like a Google Sheets link.' }, { status: 400 });

  const cfg: SheetConfig = { spreadsheetId: id, tab: parsed.data.tab, url: parsed.data.url, lastSyncAt: null, lastError: null };
  try {
    await testConnection(user.id, cfg);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
  const { error } = await supabase.from('user_settings').update({ sheet: cfg }).eq('user_id', user.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ ok: true, spreadsheetId: id });
}

export async function DELETE() {
  const { supabase, user } = await requireUser();
  if (!user) return unauthorized();
  await supabase.from('user_settings').update({ sheet: null }).eq('user_id', user.id);
  return NextResponse.json({ ok: true });
}

// Sync now / full resync
export async function POST(req: Request) {
  const { supabase, user } = await requireUser();
  if (!user) return unauthorized();
  const parsed = z.object({ mode: z.enum(['now', 'full']) }).safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'Invalid request' }, { status: 400 });

  const { data: s } = await supabase.from('user_settings').select('sheet').eq('user_id', user.id).single();
  const cfg = s?.sheet as SheetConfig | null;
  if (!cfg?.spreadsheetId) return NextResponse.json({ ok: true, skipped: true });

  try {
    if (parsed.data.mode === 'full') {
      const total = await fullResync(user.id, cfg);
      await recordSyncResult(user.id, cfg, null);
      return NextResponse.json({ ok: true, total });
    }
    const r = await drainOutbox(user.id, cfg);
    await recordSyncResult(user.id, cfg, r.failed ? r.lastError : null);
    return NextResponse.json({ ok: true, ...r });
  } catch (e) {
    const msg = explain(e);
    await recordSyncResult(user.id, cfg, msg);
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
