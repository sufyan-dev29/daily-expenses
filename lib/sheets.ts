import 'server-only';
import { google, type sheets_v4 } from 'googleapis';
import { supabaseAdmin } from '@/lib/supabase/server';
import { loadSecret } from '@/lib/secrets';
import type { SheetConfig } from '@/lib/types';

export const SHEET_HEADERS = [
  'Date', 'Description', 'Category', 'Amount', 'Payment Mode', 'Bank Name', 'Type', 'Notes', 'Entry', 'ID',
] as const;
const ID_COL = 'J'; // 10th column
const LAST_COL = 'J';

export function parseSpreadsheetId(input: string): string | null {
  const m = input.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  if (m) return m[1];
  return /^[a-zA-Z0-9-_]{20,}$/.test(input.trim()) ? input.trim() : null;
}

async function client(userId: string): Promise<sheets_v4.Sheets> {
  const raw = await loadSecret(userId, 'google_sa');
  if (!raw) throw new Error('Google service account key is not configured');
  const creds = JSON.parse(raw);
  const auth = new google.auth.JWT({
    email: creds.client_email,
    key: creds.private_key,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
  return google.sheets({ version: 'v4', auth });
}

const q = (tab: string) => `'${tab.replace(/'/g, "''")}'`;

async function sheetIdOfTab(api: sheets_v4.Sheets, spreadsheetId: string, tab: string): Promise<number> {
  const meta = await api.spreadsheets.get({ spreadsheetId, fields: 'sheets.properties' });
  const found = meta.data.sheets?.find((s) => s.properties?.title === tab);
  if (!found) throw new Error(`Tab "${tab}" not found in the spreadsheet`);
  return found.properties!.sheetId!;
}

/** Writes the header row if missing. Throws a readable error if access is denied. */
export async function ensureHeader(userId: string, cfg: SheetConfig) {
  const api = await client(userId);
  try {
    const r = await api.spreadsheets.values.get({
      spreadsheetId: cfg.spreadsheetId,
      range: `${q(cfg.tab)}!A1:${LAST_COL}1`,
    });
    const row = r.data.values?.[0] ?? [];
    if (row.join('|') !== SHEET_HEADERS.join('|')) {
      await api.spreadsheets.values.update({
        spreadsheetId: cfg.spreadsheetId,
        range: `${q(cfg.tab)}!A1:${LAST_COL}1`,
        valueInputOption: 'RAW',
        requestBody: { values: [[...SHEET_HEADERS]] },
      });
    }
  } catch (e) {
    throw new Error(explain(e));
  }
}

/**
 * Makes column A a real date column. Dates are sent as ISO text and Google turns them into date values, but a new or
 * imported column is often formatted as a plain number, which then shows 46300 instead of 05 Oct 2026.
 */
async function formatDateColumn(api: sheets_v4.Sheets, cfg: SheetConfig) {
  const sheetId = await sheetIdOfTab(api, cfg.spreadsheetId, cfg.tab);
  await api.spreadsheets.batchUpdate({
    spreadsheetId: cfg.spreadsheetId,
    requestBody: {
      requests: [
        {
          repeatCell: {
            range: { sheetId, startRowIndex: 1, startColumnIndex: 0, endColumnIndex: 1 },
            cell: { userEnteredFormat: { numberFormat: { type: 'DATE', pattern: 'dd mmm yyyy' }, horizontalAlignment: 'LEFT' } },
            fields: 'userEnteredFormat.numberFormat,userEnteredFormat.horizontalAlignment',
          },
        },
      ],
    },
  });
}

export function explain(e: unknown): string {
  const err = e as { code?: number; message?: string };
  if (err.code === 403) return 'Access denied. Share the sheet with the service account email as Editor.';
  if (err.code === 404) return 'Spreadsheet not found. Check the link.';
  if (err.code === 400 && /Unable to parse range/.test(err.message ?? '')) return 'Tab not found. Check the tab name.';
  return err.message ?? 'Unknown Google Sheets error';
}

export async function testConnection(userId: string, cfg: SheetConfig) {
  await ensureHeader(userId, cfg);
  await formatDateColumn(await client(userId), cfg).catch(() => {});
}

interface Row {
  id: string;
  kind: string;
  name: string;
  amount: number;
  occurred_on: string;
  deleted_at: string | null;
  need_want: string | null;
  notes: string | null;
  category: { name: string } | null;
  bank: { name: string } | null;
  mode: { name: string } | null;
  source: { name: string } | null;
}

const SELECT =
  'id,kind,name,amount,occurred_on,deleted_at,need_want,notes,category:options!transactions_category_id_fkey(name),bank:options!transactions_bank_id_fkey(name),mode:options!transactions_payment_mode_id_fkey(name),source:options!transactions_income_source_id_fkey(name)';

function toValues(r: Row): (string | number)[] {
  const label = r.kind === 'income' ? r.source?.name ?? '' : r.category?.name ?? '';
  return [
    r.occurred_on,
    r.name,
    label,
    Number(r.amount),
    r.mode?.name ?? '',
    r.bank?.name ?? '',
    r.need_want ? (r.need_want === 'need' ? 'Need' : 'Want') : '',
    r.notes ?? '',
    r.kind === 'income' ? 'Income' : 'Expense',
    r.id,
  ];
}

async function findRow(api: sheets_v4.Sheets, cfg: SheetConfig, id: string): Promise<number | null> {
  const r = await api.spreadsheets.values.get({
    spreadsheetId: cfg.spreadsheetId,
    range: `${q(cfg.tab)}!${ID_COL}:${ID_COL}`,
  });
  const col = r.data.values ?? [];
  const idx = col.findIndex((c) => c[0] === id);
  return idx === -1 ? null : idx + 1; // 1-based
}

async function deleteRowById(api: sheets_v4.Sheets, cfg: SheetConfig, id: string) {
  const row = await findRow(api, cfg, id);
  if (!row || row === 1) return;
  const sheetId = await sheetIdOfTab(api, cfg.spreadsheetId, cfg.tab);
  await api.spreadsheets.batchUpdate({
    spreadsheetId: cfg.spreadsheetId,
    requestBody: {
      requests: [{ deleteDimension: { range: { sheetId, dimension: 'ROWS', startIndex: row - 1, endIndex: row } } }],
    },
  });
}

async function upsertRow(api: sheets_v4.Sheets, cfg: SheetConfig, r: Row) {
  const values = [toValues(r)];
  const row = await findRow(api, cfg, r.id);
  if (row) {
    await api.spreadsheets.values.update({
      spreadsheetId: cfg.spreadsheetId,
      range: `${q(cfg.tab)}!A${row}:${LAST_COL}${row}`,
      valueInputOption: 'USER_ENTERED',
      requestBody: { values },
    });
  } else {
    await api.spreadsheets.values.append({
      spreadsheetId: cfg.spreadsheetId,
      range: `${q(cfg.tab)}!A:${LAST_COL}`,
      valueInputOption: 'USER_ENTERED',
      insertDataOption: 'INSERT_ROWS',
      requestBody: { values },
    });
  }
}

/** Processes due outbox rows for a user. Returns counts. Safe to call repeatedly. */
export async function drainOutbox(userId: string, cfg: SheetConfig, limit = 50) {
  const admin = supabaseAdmin();
  const { data: jobs } = await admin
    .from('sync_outbox')
    .select('*')
    .eq('user_id', userId)
    .lte('next_attempt_at', new Date().toISOString())
    .order('id')
    .limit(limit);

  let synced = 0;
  let failed = 0;
  let lastError: string | null = null;
  if (!jobs?.length) return { synced, failed, lastError };

  const api = await client(userId);
  await ensureHeader(userId, cfg);
  await formatDateColumn(api, cfg).catch(() => {}); // cosmetic: never block a sync on it

  for (const job of jobs) {
    try {
      const { data: tx } = await admin
        .from('transactions')
        .select(SELECT)
        .eq('id', job.transaction_id)
        .eq('user_id', userId)
        .maybeSingle();

      // a trashed (soft-deleted) entry is removed from the sheet; restoring it appends it again
      if (job.op === 'delete' || !tx || (tx as unknown as Row).deleted_at) {
        await deleteRowById(api, cfg, job.transaction_id);
      } else {
        await upsertRow(api, cfg, tx as unknown as Row);
        await admin
          .from('transactions')
          .update({ sheet_synced_at: new Date().toISOString() })
          .eq('id', job.transaction_id);
      }
      await admin.from('sync_outbox').delete().eq('id', job.id);
      synced++;
    } catch (e) {
      failed++;
      lastError = explain(e);
      const attempts = job.attempts + 1;
      const backoffMin = Math.min(60 * 24, 2 ** attempts);
      await admin
        .from('sync_outbox')
        .update({
          attempts,
          last_error: lastError,
          next_attempt_at: new Date(Date.now() + backoffMin * 60_000).toISOString(),
        })
        .eq('id', job.id);
    }
  }
  return { synced, failed, lastError };
}

/** Clears the tab body and rewrites everything from the database. */
export async function fullResync(userId: string, cfg: SheetConfig) {
  const admin = supabaseAdmin();
  const api = await client(userId);
  await ensureHeader(userId, cfg);
  await formatDateColumn(api, cfg).catch(() => {});

  await api.spreadsheets.values.clear({
    spreadsheetId: cfg.spreadsheetId,
    range: `${q(cfg.tab)}!A2:${LAST_COL}`,
  });

  let from = 0;
  const page = 1000;
  let total = 0;
  for (;;) {
    const { data } = await admin
      .from('transactions')
      .select(SELECT)
      .eq('user_id', userId)
      .is('deleted_at', null)
      .order('occurred_on')
      .order('created_at')
      .range(from, from + page - 1);
    if (!data?.length) break;
    await api.spreadsheets.values.append({
      spreadsheetId: cfg.spreadsheetId,
      range: `${q(cfg.tab)}!A:${LAST_COL}`,
      valueInputOption: 'USER_ENTERED',
      insertDataOption: 'INSERT_ROWS',
      requestBody: { values: (data as unknown as Row[]).map(toValues) },
    });
    total += data.length;
    if (data.length < page) break;
    from += page;
  }
  await admin.from('sync_outbox').delete().eq('user_id', userId);
  return total;
}

export async function recordSyncResult(userId: string, cfg: SheetConfig, error: string | null) {
  const next: SheetConfig = { ...cfg, lastSyncAt: error ? cfg.lastSyncAt ?? null : new Date().toISOString(), lastError: error };
  await supabaseAdmin().from('user_settings').update({ sheet: next }).eq('user_id', userId);
}
