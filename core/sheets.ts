/**
 * Google Sheets sync for the on-device app, written against the REST API so it runs inside the WebView.
 * - The service-account JWT is signed on the device with WebCrypto (RS256); the private key never leaves the phone.
 * - Changes are queued by database triggers (sync_outbox) and sent here in batches. Offline = keep the queue and stop.
 * - Text written to the sheet is neutralised against formula injection (=, +, -, @ at the start of a cell).
 */
import type { SqlDb, SqlValue } from './db.ts';
import { one } from './db.ts';
import { fromBase64, toBase64, utf8 } from './bytes.ts';
import { fromMinor } from './money.ts';
import { deleteSecret, getSecret, GOOGLE_KEY, NEEDS_FULL_RESYNC } from './secrets.ts';

export const SHEET_HEADERS = ['Date', 'Description', 'Category', 'Amount', 'Payment Mode', 'Bank Name', 'Type', 'Notes', 'Entry', 'ID'] as const;
const LAST_COL = 'J';
const ID_COL = 'J';
const API = 'https://sheets.googleapis.com/v4/spreadsheets';
const SCOPE = 'https://www.googleapis.com/auth/spreadsheets';

export interface SheetConfig { spreadsheetId: string; tab: string; url?: string; lastSyncAt?: string | null; lastError?: string | null }
export interface HttpResponse { ok: boolean; status: number; json(): Promise<any>; text(): Promise<string> }
export type FetchLike = (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string }) => Promise<HttpResponse>;
export interface SheetsDeps { fetch: FetchLike; now?: () => number; sleep?: (ms: number) => Promise<void> }

export class SheetsError extends Error {
  status: number;
  constructor(message: string, status = 0) { super(message); this.status = status; }
}
export class OfflineError extends Error {}

export function parseSpreadsheetId(input: string): string | null {
  const m = input.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  if (m) return m[1];
  return /^[a-zA-Z0-9-_]{20,}$/.test(input.trim()) ? input.trim() : null;
}

export function explain(e: unknown): string {
  if (e instanceof OfflineError) return 'No internet connection.';
  const err = e as { status?: number; message?: string };
  if (err.status === 403) return 'Access denied. Share the sheet with the service account email as Editor.';
  if (err.status === 404) return 'Spreadsheet not found. Check the link.';
  if (err.status === 400 && /Unable to parse range/.test(err.message ?? '')) return 'Tab not found. Check the tab name.';
  if (err.status === 401) return 'Google rejected the service account key. Remove it and add it again.';
  return err.message ?? 'Unknown Google Sheets error';
}

export function parseServiceAccount(json: string): { client_email: string; private_key: string; token_uri?: string } {
  let k: any;
  try { k = JSON.parse(json); } catch { throw new SheetsError('That is not valid JSON.'); }
  if (!k || typeof k !== 'object' || k.type !== 'service_account' || typeof k.client_email !== 'string' || typeof k.private_key !== 'string' || !k.private_key.includes('PRIVATE KEY')) {
    throw new SheetsError('That does not look like a Google service account key (it needs type, client_email and private_key).');
  }
  return k;
}

const b64url = (b: Uint8Array) => toBase64(b).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

async function signJwt(key: { client_email: string; private_key: string; token_uri?: string }, nowSec: number): Promise<string> {
  const pem = key.private_key.replace(/-----BEGIN PRIVATE KEY-----|-----END PRIVATE KEY-----|\s+/g, '');
  let der: Uint8Array;
  try { der = fromBase64(pem); } catch { throw new SheetsError('The private key in the service account file is damaged.'); }
  let cryptoKey: CryptoKey;
  try { cryptoKey = await crypto.subtle.importKey('pkcs8', der as BufferSource, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']); }
  catch { throw new SheetsError('The private key in the service account file could not be read.'); }
  const head = b64url(utf8(JSON.stringify({ alg: 'RS256', typ: 'JWT' })));
  const claim = b64url(utf8(JSON.stringify({ iss: key.client_email, scope: SCOPE, aud: key.token_uri || 'https://oauth2.googleapis.com/token', iat: nowSec, exp: nowSec + 3600 })));
  const sig = new Uint8Array(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', cryptoKey, utf8(`${head}.${claim}`) as BufferSource));
  return `${head}.${claim}.${b64url(sig)}`;
}

export class SheetsClient {
  private token: { value: string; exp: number } | null = null;
  private key: { client_email: string; private_key: string; token_uri?: string };
  private deps: Required<SheetsDeps>;

  constructor(keyJson: string, deps: SheetsDeps) {
    this.key = parseServiceAccount(keyJson);
    this.deps = { now: () => Date.now(), sleep: (ms) => new Promise((r) => setTimeout(r, ms)), ...deps };
  }
  get email() { return this.key.client_email; }

  private async raw(url: string, init?: { method?: string; headers?: Record<string, string>; body?: string }): Promise<HttpResponse> {
    try { return await this.deps.fetch(url, init); }
    catch { throw new OfflineError('offline'); }
  }

  private async accessToken(): Promise<string> {
    const now = this.deps.now();
    if (this.token && this.token.exp - 60_000 > now) return this.token.value;
    const jwt = await signJwt(this.key, Math.floor(now / 1000));
    const res = await this.raw(this.key.token_uri || 'https://oauth2.googleapis.com/token', {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `grant_type=${encodeURIComponent('urn:ietf:params:oauth:grant-type:jwt-bearer')}&assertion=${encodeURIComponent(jwt)}`,
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok || !body.access_token) {
      const detail = body.error_description || body.error || `HTTP ${res.status}`;
      throw new SheetsError(`Google sign-in failed (${detail}). Check the service account key and your device clock.`, 0);
    }
    this.token = { value: body.access_token, exp: now + (Number(body.expires_in) || 3600) * 1000 };
    return this.token.value;
  }

  async call(method: string, path: string, body?: unknown): Promise<any> {
    for (let attempt = 0; ; attempt++) {
      const token = await this.accessToken();
      const res = await this.raw(`${API}/${path}`, { method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
      if (res.ok) return res.json().catch(() => ({}));
      if (res.status === 401 && attempt === 0) { this.token = null; continue; }
      if ((res.status === 429 || res.status >= 500) && attempt < 3) { await this.deps.sleep(1000 * 2 ** attempt); continue; }
      const j = await res.json().catch(() => ({}));
      throw new SheetsError(j?.error?.message ?? `HTTP ${res.status}`, res.status);
    }
  }
}

const q = (tab: string) => `'${tab.replace(/'/g, "''")}'`;
const rng = (tab: string, a1: string) => encodeURIComponent(`${q(tab)}!${a1}`);

async function sheetIdOfTab(api: SheetsClient, cfg: SheetConfig): Promise<number> {
  const meta = await api.call('GET', `${cfg.spreadsheetId}?fields=sheets.properties`);
  const found = (meta.sheets ?? []).find((s: any) => s.properties?.title === cfg.tab);
  if (!found) throw new SheetsError(`Tab "${cfg.tab}" not found in the spreadsheet`, 400);
  return found.properties.sheetId;
}

export async function ensureHeader(api: SheetsClient, cfg: SheetConfig) {
  const r = await api.call('GET', `${cfg.spreadsheetId}/values/${rng(cfg.tab, `A1:${LAST_COL}1`)}`);
  const row: string[] = r.values?.[0] ?? [];
  if (row.join('|') !== SHEET_HEADERS.join('|')) {
    await api.call('PUT', `${cfg.spreadsheetId}/values/${rng(cfg.tab, `A1:${LAST_COL}1`)}?valueInputOption=RAW`, { values: [[...SHEET_HEADERS]] });
  }
}

/** Makes column A a real date column so Google shows 05 Oct 2026 instead of 46300. Cosmetic, never fatal. */
async function formatDateColumn(api: SheetsClient, cfg: SheetConfig) {
  try {
    const sheetId = await sheetIdOfTab(api, cfg);
    await api.call('POST', `${cfg.spreadsheetId}:batchUpdate`, { requests: [{ repeatCell: { range: { sheetId, startRowIndex: 1, startColumnIndex: 0, endColumnIndex: 1 }, cell: { userEnteredFormat: { numberFormat: { type: 'DATE', pattern: 'dd mmm yyyy' }, horizontalAlignment: 'LEFT' } }, fields: 'userEnteredFormat.numberFormat,userEnteredFormat.horizontalAlignment' } }] });
  } catch (e) { if (e instanceof OfflineError) throw e; }
}

export async function testConnection(api: SheetsClient, cfg: SheetConfig) {
  try { await ensureHeader(api, cfg); } catch (e) { throw new SheetsError(explain(e), (e as SheetsError).status); }
  await formatDateColumn(api, cfg);
}

/** Stops a text cell from being read as a formula when Google parses it (USER_ENTERED). */
export function safeCell(v: string): string {
  return /^[=+\-@\t\r]/.test(v) ? "'" + v : v;
}

interface TxRow { id: string; kind: string; name: string; amount_minor: number; occurred_on: string; need_want: string | null; notes: string | null; deleted_at: string | null; category: string | null; bank: string | null; mode: string | null; source: string | null }

const SELECT = `SELECT t.id, t.kind, t.name, t.amount_minor, t.occurred_on, t.need_want, t.notes, t.deleted_at,
  c.name AS category, b.name AS bank, m.name AS mode, s.name AS source
  FROM transactions t
  LEFT JOIN options c ON c.id = t.category_id LEFT JOIN options b ON b.id = t.bank_id
  LEFT JOIN options m ON m.id = t.payment_mode_id LEFT JOIN options s ON s.id = t.income_source_id`;

export function toValues(r: TxRow): (string | number)[] {
  const label = r.kind === 'income' ? r.source ?? '' : r.category ?? '';
  return [r.occurred_on, safeCell(r.name), safeCell(label), fromMinor(r.amount_minor), safeCell(r.mode ?? ''), safeCell(r.bank ?? ''), r.need_want ? (r.need_want === 'need' ? 'Need' : 'Want') : '', safeCell(r.notes ?? ''), r.kind === 'income' ? 'Income' : 'Expense', r.id];
}

const iso = (ms: number) => new Date(ms).toISOString();

interface Job { id: number; transaction_id: string; op: string; attempts: number; rev: number }

export interface DrainResult { synced: number; failed: number; lastError: string | null; offline: boolean }

/** Sends due queue entries in a few batched calls. Entries changed while syncing stay queued (rev check). */
export async function drainOutbox(db: SqlDb, api: SheetsClient, cfg: SheetConfig, limit = 200, nowMs = Date.now()): Promise<DrainResult> {
  const jobs = await db.all<Job>('SELECT id, transaction_id, op, attempts, rev FROM sync_outbox WHERE next_attempt_at <= ? ORDER BY id LIMIT ?', [iso(nowMs), limit]);
  if (!jobs.length) return { synced: 0, failed: 0, lastError: null, offline: false };

  const fail = async (list: Job[], e: unknown) => {
    const msg = explain(e);
    for (const j of list) {
      const attempts = j.attempts + 1;
      const backoffMin = Math.min(60 * 24, 2 ** attempts);
      await db.run('UPDATE sync_outbox SET attempts = ?, last_error = ?, next_attempt_at = ? WHERE id = ? AND rev = ?', [attempts, msg, iso(nowMs + backoffMin * 60_000), j.id, j.rev]);
    }
    return msg;
  };

  try {
    await ensureHeader(api, cfg);
    const idCol: string[][] = (await api.call('GET', `${cfg.spreadsheetId}/values/${rng(cfg.tab, `${ID_COL}:${ID_COL}`)}`)).values ?? [];
    const rowsOf = new Map<string, number[]>();
    idCol.forEach((c, i) => { if (i > 0 && c[0]) { const a = rowsOf.get(c[0]) ?? []; a.push(i + 1); rowsOf.set(c[0], a); } });

    const updates: { range: string; values: (string | number)[][] }[] = [];
    const appends: (string | number)[][] = [];
    const deletes: number[] = [];
    const doneUpserts: Job[] = []; const doneDeletes: Job[] = [];
    for (const j of jobs) {
      const tx = (await db.all<TxRow>(`${SELECT} WHERE t.id = ?`, [j.transaction_id]))[0];
      const existing = rowsOf.get(j.transaction_id) ?? [];
      if (j.op === 'delete' || !tx || tx.deleted_at) { deletes.push(...existing); doneDeletes.push(j); continue; }
      const values = toValues(tx);
      if (existing.length) {
        updates.push({ range: `${q(cfg.tab)}!A${existing[0]}:${LAST_COL}${existing[0]}`, values: [values] });
        deletes.push(...existing.slice(1)); // duplicates of the same entry
      } else appends.push(values);
      doneUpserts.push(j);
    }

    if (updates.length) await api.call('POST', `${cfg.spreadsheetId}/values:batchUpdate`, { valueInputOption: 'USER_ENTERED', data: updates });
    if (appends.length) await api.call('POST', `${cfg.spreadsheetId}/values/${rng(cfg.tab, `A:${LAST_COL}`)}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`, { values: appends });
    if (deletes.length) {
      const sheetId = await sheetIdOfTab(api, cfg);
      const rows = [...new Set(deletes)].filter((r) => r > 1).sort((a, b) => b - a); // bottom-up so row numbers stay valid
      await api.call('POST', `${cfg.spreadsheetId}:batchUpdate`, { requests: rows.map((r) => ({ deleteDimension: { range: { sheetId, dimension: 'ROWS', startIndex: r - 1, endIndex: r } } })) });
    }

    const stamp = new Date(nowMs).toISOString();
    await db.transaction(async () => {
      for (const j of doneUpserts) await db.run('UPDATE transactions SET sheet_synced_at = ? WHERE id = ?', [stamp, j.transaction_id]);
      for (const j of [...doneUpserts, ...doneDeletes]) await db.run('DELETE FROM sync_outbox WHERE id = ? AND rev = ?', [j.id, j.rev]);
    });
    return { synced: jobs.length, failed: 0, lastError: null, offline: false };
  } catch (e) {
    if (e instanceof OfflineError) return { synced: 0, failed: 0, lastError: null, offline: true };
    const msg = await fail(jobs, e);
    return { synced: 0, failed: jobs.length, lastError: msg, offline: false };
  }
}

/** Clears the tab body and rewrites every live entry from the database. */
export async function fullResync(db: SqlDb, api: SheetsClient, cfg: SheetConfig): Promise<number> {
  try { await ensureHeader(api, cfg); } catch (e) { if (e instanceof OfflineError) throw e; throw new SheetsError(explain(e), (e as SheetsError).status); }
  await formatDateColumn(api, cfg);
  await api.call('POST', `${cfg.spreadsheetId}/values/${rng(cfg.tab, `A2:${LAST_COL}`)}:clear`, {});
  await db.run('DELETE FROM sync_outbox'); // anything changed after this point queues again
  let total = 0;
  for (let offset = 0; ; offset += 1000) {
    const rows = await db.all<TxRow>(`${SELECT} WHERE t.deleted_at IS NULL ORDER BY t.occurred_on, t.created_at, t.id LIMIT 1000 OFFSET ?`, [offset]);
    if (!rows.length) break;
    await api.call('POST', `${cfg.spreadsheetId}/values/${rng(cfg.tab, `A:${LAST_COL}`)}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`, { values: rows.map(toValues) });
    total += rows.length;
    if (rows.length < 1000) break;
  }
  await db.run('UPDATE transactions SET sheet_synced_at = ? WHERE deleted_at IS NULL', [new Date().toISOString()]);
  return total;
}

export interface SyncOutcome { skipped?: 'offline-mode' | 'no-sheet' | 'no-key'; synced: number; failed: number; total?: number; offline: boolean; error: string | null }

async function recordResult(db: SqlDb, cfg: SheetConfig, error: string | null) {
  const cur = await one<{ sheet: string | null }>(db, 'SELECT sheet FROM settings WHERE id = 1');
  if (!cur?.sheet) return; // disconnected in the meantime
  const merged: SheetConfig = { ...JSON.parse(cur.sheet), lastError: error };
  if (!error) merged.lastSyncAt = new Date().toISOString();
  await db.run('UPDATE settings SET sheet = ? WHERE id = 1', [JSON.stringify(merged) as SqlValue]);
}

const running = new WeakMap<object, Promise<SyncOutcome>>();

/**
 * Entry point used by the app: on open, on resume, when the network returns and after every change.
 * One run at a time per database. Offline is not an error: the queue simply waits.
 */
export function runSync(db: SqlDb, deps: SheetsDeps, opts: { full?: boolean } = {}): Promise<SyncOutcome> {
  const existing = running.get(db);
  if (existing) return existing.then(() => (opts.full ? runSync(db, deps, opts) : existing));
  const p = doSync(db, deps, opts).finally(() => running.delete(db));
  running.set(db, p);
  return p;
}

async function doSync(db: SqlDb, deps: SheetsDeps, opts: { full?: boolean }): Promise<SyncOutcome> {
  const s = await one<{ mode: string; sheet: string | null }>(db, 'SELECT mode, sheet FROM settings WHERE id = 1');
  if (!s || s.mode !== 'online') return { skipped: 'offline-mode', synced: 0, failed: 0, offline: false, error: null };
  const cfg: SheetConfig | null = s.sheet ? JSON.parse(s.sheet) : null;
  if (!cfg?.spreadsheetId) return { skipped: 'no-sheet', synced: 0, failed: 0, offline: false, error: null };
  const keyJson = await getSecret(db, GOOGLE_KEY);
  if (!keyJson) return { skipped: 'no-key', synced: 0, failed: 0, offline: false, error: 'Google service account key is not configured' };

  try {
    const api = new SheetsClient(keyJson, deps);
    const needsFull = opts.full || (await getSecret(db, NEEDS_FULL_RESYNC)) !== null;
    if (needsFull) {
      const total = await fullResync(db, api, cfg);
      await deleteSecret(db, NEEDS_FULL_RESYNC);
      await recordResult(db, cfg, null);
      return { synced: 0, failed: 0, total, offline: false, error: null };
    }
    let synced = 0, failed = 0, lastError: string | null = null;
    for (let pass = 0; pass < 20; pass++) {
      const r = await drainOutbox(db, api, cfg, 200, (deps.now ?? Date.now)());
      if (r.offline) return { synced, failed, offline: true, error: null };
      synced += r.synced; failed += r.failed; lastError = r.lastError ?? lastError;
      if (r.synced + r.failed < 200) break;
    }
    await recordResult(db, cfg, failed ? lastError : null);
    return { synced, failed, offline: false, error: failed ? lastError : null };
  } catch (e) {
    if (e instanceof OfflineError) return { synced: 0, failed: 0, offline: true, error: null };
    const msg = explain(e);
    await recordResult(db, cfg, msg);
    return { synced: 0, failed: 0, offline: false, error: msg };
  }
}
