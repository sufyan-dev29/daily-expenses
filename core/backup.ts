/**
 * Backup and restore.
 *
 * File = a zip with one entry, manifest.json. The manifest has a readable header and the whole data set as an
 * AES-256-GCM ciphertext (key from PBKDF2-SHA256 over the backup password). Encryption is mandatory because the
 * data includes the Google service-account private key. The header is bound to the ciphertext as AAD, so editing
 * counts/version/KDF settings makes decryption fail. Restore validates everything before touching the database
 * and applies it in one transaction.
 */
import type { SqlDb, SqlValue } from './db.ts';
import { one } from './db.ts';
import { SCHEMA_VERSION } from './schema.ts';
import { fromBase64, fromUtf8, randomBytes, toBase64, utf8 } from './bytes.ts';
import { unzip, zip, ZipError } from './zip.ts';
import { deleteSecret, getSecret, GOOGLE_KEY, NEEDS_FULL_RESYNC, setSecret } from './secrets.ts';

export const BACKUP_FORMAT = 'daily-expenses-backup';
export const BACKUP_VERSION = 1;
export const KDF_ITERATIONS = 600_000;
const KDF_MIN = 100_000;
const KDF_MAX = 5_000_000;
export const MIN_PASSWORD_LENGTH = 8;
const MAX_ROWS = { transactions: 500_000, options: 5_000, templates: 1_000 };

export type BackupErrorCode = 'bad_file' | 'wrong_password' | 'too_new' | 'invalid_data' | 'weak_password';
export class BackupError extends Error {
  code: BackupErrorCode;
  constructor(message: string, code: BackupErrorCode = 'bad_file') { super(message); this.code = code; }
}

export interface OptionRow { id: string; kind: string; name: string; sort_order: number; color: string | null; icon: string | null; archived_at: string | null; created_at: string }
export interface TxRow { id: string; kind: string; name: string; amount_minor: number; occurred_on: string; category_id: string | null; bank_id: string | null; payment_mode_id: string | null; income_source_id: string | null; need_want: string | null; notes: string | null; deleted_at: string | null; created_at: string; updated_at: string }
export interface TemplateRow { id: string; kind: string; name: string; behavior: string; payload: string; sort_order: number; created_at: string }
export interface SettingsRow { mode: string; theme_mode: string; accent_hex: string; currency: string; locale: string; date_format: string; week_start: number; timezone: string; remember_last: string; trash_retention_days: number; sheet: string | null }

export interface BackupData {
  account: { username: string };
  settings: SettingsRow;
  options: OptionRow[];
  transactions: TxRow[];
  templates: TemplateRow[];
  /** Raw service-account JSON, kept so a restored app can sync straight away. */
  serviceAccountKey: string | null;
}

export interface BackupHeader {
  format: typeof BACKUP_FORMAT;
  version: number;
  schemaVersion: number;
  createdAt: string;
  app: string;
  counts: { transactions: number; options: number; templates: number };
  encryption: { cipher: 'AES-256-GCM'; kdf: 'PBKDF2-SHA256'; iterations: number; salt: string; iv: string };
}
interface Manifest extends BackupHeader { ciphertext: string }

const SETTINGS_COLS = 'mode, theme_mode, accent_hex, currency, locale, date_format, week_start, timezone, remember_last, trash_retention_days, sheet';

export async function collectData(db: SqlDb, account: { username: string }, serviceAccountKey?: string | null): Promise<BackupData> {
  const settings = await one<SettingsRow>(db, `SELECT ${SETTINGS_COLS} FROM settings WHERE id = 1`);
  if (!settings) throw new BackupError('Settings are missing.', 'invalid_data');
  return {
    account: { username: account.username },
    settings,
    options: await db.all<OptionRow>('SELECT id, kind, name, sort_order, color, icon, archived_at, created_at FROM options ORDER BY kind, sort_order, name'),
    transactions: await db.all<TxRow>('SELECT id, kind, name, amount_minor, occurred_on, category_id, bank_id, payment_mode_id, income_source_id, need_want, notes, deleted_at, created_at, updated_at FROM transactions ORDER BY created_at, id'),
    templates: await db.all<TemplateRow>('SELECT id, kind, name, behavior, payload, sort_order, created_at FROM templates ORDER BY kind, sort_order, name'),
    serviceAccountKey: serviceAccountKey !== undefined ? serviceAccountKey : await getSecret(db, GOOGLE_KEY),
  };
}

async function deriveKey(password: string, salt: Uint8Array, iterations: number): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey('raw', utf8(password.normalize('NFKC')) as BufferSource, 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt: salt as BufferSource, iterations }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

const aadOf = (h: BackupHeader) => utf8(JSON.stringify({ format: h.format, version: h.version, schemaVersion: h.schemaVersion, createdAt: h.createdAt, app: h.app, counts: h.counts, kdf: h.encryption.kdf, cipher: h.encryption.cipher, iterations: h.encryption.iterations }));

export async function createBackup(data: BackupData, password: string, opts: { iterations?: number; now?: Date } = {}): Promise<Uint8Array> {
  if (typeof password !== 'string' || password.length < MIN_PASSWORD_LENGTH) throw new BackupError(`Choose a backup password of at least ${MIN_PASSWORD_LENGTH} characters.`, 'weak_password');
  const iterations = opts.iterations ?? KDF_ITERATIONS;
  const salt = randomBytes(16), iv = randomBytes(12);
  const header: BackupHeader = {
    format: BACKUP_FORMAT, version: BACKUP_VERSION, schemaVersion: SCHEMA_VERSION,
    createdAt: (opts.now ?? new Date()).toISOString(), app: 'Daily Expenses',
    counts: { transactions: data.transactions.length, options: data.options.length, templates: data.templates.length },
    encryption: { cipher: 'AES-256-GCM', kdf: 'PBKDF2-SHA256', iterations, salt: toBase64(salt), iv: toBase64(iv) },
  };
  const key = await deriveKey(password, salt, iterations);
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv as BufferSource, additionalData: aadOf(header) as BufferSource, tagLength: 128 }, key, utf8(JSON.stringify(data)) as BufferSource));
  const manifest: Manifest = { ...header, ciphertext: toBase64(ct) };
  return zip([{ name: 'manifest.json', data: utf8(JSON.stringify(manifest, null, 1)) }], opts.now);
}

export async function readHeader(file: Uint8Array): Promise<BackupHeader> {
  return (await parseManifest(file)).header;
}

async function parseManifest(file: Uint8Array): Promise<{ header: BackupHeader; ciphertext: Uint8Array }> {
  let entries;
  try { entries = await unzip(file); } catch (e) { if (e instanceof ZipError) throw new BackupError(e.message); throw e; }
  const entry = entries.find((x) => x.name === 'manifest.json');
  if (!entry) throw new BackupError('This is not a Daily Expenses backup (manifest.json is missing).');
  let m: any;
  try { m = JSON.parse(fromUtf8(entry.data)); } catch { throw new BackupError('The backup manifest is damaged.'); }
  if (!m || typeof m !== 'object' || m.format !== BACKUP_FORMAT) throw new BackupError('This is not a Daily Expenses backup.');
  if (!Number.isInteger(m.version) || m.version < 1) throw new BackupError('The backup manifest is damaged.');
  if (m.version > BACKUP_VERSION || (Number.isInteger(m.schemaVersion) && m.schemaVersion > SCHEMA_VERSION)) throw new BackupError('This backup was made by a newer version of the app. Update the app and try again.', 'too_new');
  const e = m.encryption;
  const isStr = (v: unknown) => typeof v === 'string';
  if (!e || e.cipher !== 'AES-256-GCM' || e.kdf !== 'PBKDF2-SHA256' || !Number.isInteger(e.iterations) || e.iterations < KDF_MIN || e.iterations > KDF_MAX || !isStr(e.salt) || !isStr(e.iv) || !isStr(m.ciphertext) || !isStr(m.createdAt) || !isStr(m.app) || !Number.isInteger(m.schemaVersion)) throw new BackupError('The backup manifest is damaged.');
  const c = m.counts;
  if (!c || !['transactions', 'options', 'templates'].every((k) => Number.isInteger(c[k]) && c[k] >= 0)) throw new BackupError('The backup manifest is damaged.');
  let ciphertext: Uint8Array;
  try {
    if (fromBase64(e.salt).length !== 16 || fromBase64(e.iv).length !== 12) throw new Error();
    ciphertext = fromBase64(m.ciphertext);
  } catch { throw new BackupError('The backup manifest is damaged.'); }
  const header: BackupHeader = { format: BACKUP_FORMAT, version: m.version, schemaVersion: m.schemaVersion, createdAt: m.createdAt, app: m.app, counts: { transactions: c.transactions, options: c.options, templates: c.templates }, encryption: { cipher: 'AES-256-GCM', kdf: 'PBKDF2-SHA256', iterations: e.iterations, salt: e.salt, iv: e.iv } };
  return { header, ciphertext };
}

export async function openBackup(file: Uint8Array, password: string): Promise<{ header: BackupHeader; data: BackupData }> {
  const { header, ciphertext } = await parseManifest(file);
  const key = await deriveKey(password, fromBase64(header.encryption.salt), header.encryption.iterations);
  let plain: Uint8Array;
  try {
    plain = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromBase64(header.encryption.iv) as BufferSource, additionalData: aadOf(header) as BufferSource, tagLength: 128 }, key, ciphertext as BufferSource));
  } catch { throw new BackupError('Wrong password, or the backup file has been altered.', 'wrong_password'); }
  let raw: unknown;
  try { raw = JSON.parse(fromUtf8(plain)); } catch { throw new BackupError('The backup data is damaged.', 'invalid_data'); }
  const data = validateData(raw);
  if (data.transactions.length !== header.counts.transactions || data.options.length !== header.counts.options || data.templates.length !== header.counts.templates) throw new BackupError('The backup contents do not match its header.', 'invalid_data');
  return { header, data };
}

// ---------- validation ----------
const bad = (what: string): never => { throw new BackupError(`The backup contains invalid data (${what}).`, 'invalid_data'); };
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const str = (v: unknown, what: string, max = 5000): string => (typeof v === 'string' && v.length <= max ? v : bad(what));
const nstr = (v: unknown, what: string, max = 5000): string | null => (v === null || v === undefined ? null : str(v, what, max));
const int = (v: unknown, what: string, min: number, max: number): number => (Number.isSafeInteger(v) && (v as number) >= min && (v as number) <= max ? (v as number) : bad(what));
const oneOf = <T extends string>(v: unknown, set: readonly T[], what: string): T => (set.includes(v as T) ? (v as T) : bad(what));
const idOf = (v: unknown, what: string) => { const s = str(v, what, 64); return /^[A-Za-z0-9_-]{1,64}$/.test(s) ? s : bad(what); };
const dateOnly = (v: unknown, what: string) => { const s = str(v, what, 10); if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) bad(what); const d = new Date(s + 'T00:00:00Z'); return d.toISOString().slice(0, 10) === s ? s : bad(what); };
const stamp = (v: unknown, what: string) => { const s = str(v, what, 40); return Number.isNaN(Date.parse(s)) ? bad(what) : s; };
const nstamp = (v: unknown, what: string) => (v === null || v === undefined ? null : stamp(v, what));

export function validateData(raw: unknown): BackupData {
  if (!isObj(raw)) bad('root');
  const r = raw as Record<string, any>;
  if (!isObj(r.account)) bad('account');
  const username = str(r.account.username, 'username', 64);
  if (!username.trim()) bad('username');
  const s = r.settings;
  if (!isObj(s)) bad('settings');
  const hex = str(s.accent_hex, 'accent', 30);
  if (hex !== 'system' && !/^#[0-9A-Fa-f]{6}(:[a-z]{3,12})?$/.test(hex)) bad('accent');
  const remember = str(s.remember_last, 'remember_last', 500);
  try { if (!isObj(JSON.parse(remember))) bad('remember_last'); } catch { bad('remember_last'); }
  const sheet = nstr(s.sheet, 'sheet', 2000);
  if (sheet !== null) { try { if (!isObj(JSON.parse(sheet))) bad('sheet'); } catch { bad('sheet'); } }
  const settings: SettingsRow = {
    mode: oneOf(s.mode, ['offline', 'online'] as const, 'mode'), theme_mode: oneOf(s.theme_mode, ['system', 'light', 'dark'] as const, 'theme'),
    accent_hex: hex, currency: str(s.currency, 'currency', 8), locale: str(s.locale, 'locale', 20), date_format: str(s.date_format, 'date_format', 40),
    week_start: int(s.week_start, 'week_start', 1, 7), timezone: str(s.timezone, 'timezone', 64), remember_last: remember,
    trash_retention_days: int(s.trash_retention_days, 'retention', 1, 3650), sheet,
  };
  for (const k of ['options', 'transactions', 'templates'] as const) {
    if (!Array.isArray(r[k])) bad(k);
    if (r[k].length > MAX_ROWS[k]) bad(`too many ${k}`);
  }
  const seenIds = new Set<string>(), seenNames = new Set<string>();
  const options: OptionRow[] = r.options.map((o: any) => {
    if (!isObj(o)) bad('option');
    const kind = oneOf(o.kind, ['bank', 'payment_mode', 'category', 'income_source'] as const, 'option kind');
    const name = str(o.name, 'option name', 200).trim();
    if (!name) bad('option name');
    const id = idOf(o.id, 'option id');
    const nk = kind + '|' + name.toLowerCase();
    if (seenIds.has(id) || seenNames.has(nk)) bad('duplicate option');
    seenIds.add(id); seenNames.add(nk);
    return { id, kind, name, sort_order: int(o.sort_order ?? 0, 'sort', -1e9, 1e9), color: nstr(o.color, 'color', 40), icon: nstr(o.icon, 'icon', 80), archived_at: nstamp(o.archived_at, 'archived_at'), created_at: stamp(o.created_at, 'created_at') };
  });
  const kindOf = new Map(options.map((o) => [o.id, o.kind]));
  const ref = (v: unknown, kind: string, what: string) => { if (v === null || v === undefined) return null; const id = idOf(v, what); return kindOf.get(id) === kind ? id : bad(what + ' reference'); };
  const txIds = new Set<string>();
  const transactions: TxRow[] = r.transactions.map((t: any) => {
    if (!isObj(t)) bad('transaction');
    const id = idOf(t.id, 'transaction id');
    if (txIds.has(id)) bad('duplicate transaction');
    txIds.add(id);
    const name = str(t.name, 'transaction name', 500);
    if (!name.trim()) bad('transaction name');
    return {
      id, kind: oneOf(t.kind, ['expense', 'income'] as const, 'tx kind'), name, amount_minor: int(t.amount_minor, 'amount', 1, Number.MAX_SAFE_INTEGER),
      occurred_on: dateOnly(t.occurred_on, 'date'), category_id: ref(t.category_id, 'category', 'category'), bank_id: ref(t.bank_id, 'bank', 'bank'),
      payment_mode_id: ref(t.payment_mode_id, 'payment_mode', 'payment mode'), income_source_id: ref(t.income_source_id, 'income_source', 'income source'),
      need_want: t.need_want === null || t.need_want === undefined ? null : oneOf(t.need_want, ['need', 'want'] as const, 'need/want'),
      notes: nstr(t.notes, 'notes', 5000), deleted_at: nstamp(t.deleted_at, 'deleted_at'), created_at: stamp(t.created_at, 'created_at'), updated_at: stamp(t.updated_at, 'updated_at'),
    };
  });
  const tplIds = new Set<string>();
  const templates: TemplateRow[] = r.templates.map((t: any) => {
    if (!isObj(t)) bad('template');
    const id = idOf(t.id, 'template id');
    if (tplIds.has(id)) bad('duplicate template');
    tplIds.add(id);
    const name = str(t.name, 'template name', 200);
    if (!name.trim()) bad('template name');
    const payload = str(t.payload ?? '{}', 'template payload', 5000);
    try { if (!isObj(JSON.parse(payload))) bad('template payload'); } catch { bad('template payload'); }
    return { id, kind: oneOf(t.kind, ['expense', 'income'] as const, 'template kind'), name, behavior: oneOf(t.behavior ?? 'fill', ['fill', 'instant'] as const, 'behavior'), payload, sort_order: int(t.sort_order ?? 0, 'sort', -1e9, 1e9), created_at: stamp(t.created_at, 'created_at') };
  });
  let key: string | null = null;
  if (r.serviceAccountKey !== null && r.serviceAccountKey !== undefined) {
    key = str(r.serviceAccountKey, 'service account key', 20000);
    try { const k = JSON.parse(key); if (!isObj(k) || typeof k.client_email !== 'string' || typeof k.private_key !== 'string') bad('service account key'); } catch { bad('service account key'); }
  }
  return { account: { username }, settings, options, transactions, templates, serviceAccountKey: key };
}

// ---------- restore ----------
export interface RestoreResult { mode: 'replace' | 'merge'; transactionsAdded: number; transactionsSkipped: number; optionsAdded: number; templatesAdded: number }

const chunk = <T,>(a: T[], n: number) => { const o: T[][] = []; for (let i = 0; i < a.length; i += n) o.push(a.slice(i, i + n)); return o; };

/**
 * replace: wipes the account's data and rebuilds it exactly as in the backup (settings included).
 * merge: keeps existing data and adds what the backup has that is missing (options matched by kind+name, transactions by id);
 *        existing settings are left alone.
 * Either way it is one transaction, and the sync outbox is not filled with the restored rows: after a replace the
 * caller runs a full resync instead.
 */
export async function restoreData(db: SqlDb, data: BackupData, mode: 'replace' | 'merge'): Promise<RestoreResult> {
  const res: RestoreResult = { mode, transactionsAdded: 0, transactionsSkipped: 0, optionsAdded: 0, templatesAdded: 0 };
  await db.transaction(async () => {
    // Triggers only fire in online mode, so go offline while rows are written.
    const before = await one<{ mode: string }>(db, 'SELECT mode FROM settings WHERE id = 1');
    await db.run("UPDATE settings SET mode = 'offline' WHERE id = 1");
    const idMap = new Map<string, string>();
    let toInsert: OptionRow[];
    if (mode === 'replace') {
      await db.run('DELETE FROM sync_outbox');
      await db.run('DELETE FROM transactions');
      await db.run('DELETE FROM templates');
      await db.run('DELETE FROM options');
      for (const o of data.options) idMap.set(o.id, o.id);
      toInsert = data.options;
    } else {
      const existing = await db.all<{ id: string; kind: string; name: string }>('SELECT id, kind, name FROM options');
      const byName = new Map(existing.map((e) => [e.kind + '|' + e.name.toLowerCase(), e.id]));
      const usedIds = new Set(existing.map((e) => e.id));
      toInsert = [];
      for (const o of data.options) {
        const hit = byName.get(o.kind + '|' + o.name.toLowerCase());
        if (hit) { idMap.set(o.id, hit); continue; }
        let id = o.id;
        while (usedIds.has(id)) id = o.id.slice(0, 50) + '-' + Math.random().toString(36).slice(2, 8);
        usedIds.add(id);
        idMap.set(o.id, id);
        toInsert.push({ ...o, id });
      }
    }
    for (const c of chunk(toInsert, 500)) await db.runMany('INSERT INTO options (id, kind, name, sort_order, color, icon, archived_at, created_at) VALUES (?,?,?,?,?,?,?,?)', c.map((o) => [o.id, o.kind, o.name, o.sort_order, o.color, o.icon, o.archived_at, o.created_at] as SqlValue[]));
    res.optionsAdded = toInsert.length;

    let txs = data.transactions;
    if (mode === 'merge') {
      const have = new Set((await db.all<{ id: string }>('SELECT id FROM transactions')).map((x) => x.id));
      txs = txs.filter((t) => !have.has(t.id));
      res.transactionsSkipped = data.transactions.length - txs.length;
    }
    const m = (id: string | null) => (id === null ? null : idMap.get(id) ?? null);
    for (const c of chunk(txs, 500)) await db.runMany('INSERT INTO transactions (id, kind, name, amount_minor, occurred_on, category_id, bank_id, payment_mode_id, income_source_id, need_want, notes, deleted_at, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)', c.map((t) => [t.id, t.kind, t.name, t.amount_minor, t.occurred_on, m(t.category_id), m(t.bank_id), m(t.payment_mode_id), m(t.income_source_id), t.need_want, t.notes, t.deleted_at, t.created_at, t.updated_at] as SqlValue[]));
    res.transactionsAdded = txs.length;

    let tpls = data.templates;
    if (mode === 'merge') {
      const have = new Set((await db.all<{ id: string }>('SELECT id FROM templates')).map((x) => x.id));
      tpls = tpls.filter((t) => !have.has(t.id));
    }
    for (const c of chunk(tpls, 500)) await db.runMany('INSERT INTO templates (id, kind, name, behavior, payload, sort_order, created_at) VALUES (?,?,?,?,?,?,?)', c.map((t) => [t.id, t.kind, t.name, t.behavior, t.payload, t.sort_order, t.created_at] as SqlValue[]));
    res.templatesAdded = tpls.length;

    if (mode === 'replace') {
      const s = data.settings;
      await db.run(`UPDATE settings SET mode=?, theme_mode=?, accent_hex=?, currency=?, locale=?, date_format=?, week_start=?, timezone=?, remember_last=?, trash_retention_days=?, sheet=?, updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=1`,
        [s.mode, s.theme_mode, s.accent_hex, s.currency, s.locale, s.date_format, s.week_start, s.timezone, s.remember_last, s.trash_retention_days, s.sheet]);
      if (data.serviceAccountKey) await setSecret(db, GOOGLE_KEY, data.serviceAccountKey); else await deleteSecret(db, GOOGLE_KEY);
      // the restored sheet may differ from what is on Google now: rewrite it once, on the next sync
      if (s.mode === 'online' && s.sheet) await setSecret(db, NEEDS_FULL_RESYNC, '1'); else await deleteSecret(db, NEEDS_FULL_RESYNC);
    } else if (before) {
      await db.run('UPDATE settings SET mode = ? WHERE id = 1', [before.mode]);
      if (data.serviceAccountKey && !(await getSecret(db, GOOGLE_KEY))) await setSecret(db, GOOGLE_KEY, data.serviceAccountKey);
      if (before.mode === 'online' && txs.length) await setSecret(db, NEEDS_FULL_RESYNC, '1');
    }
  });
  return res;
}
