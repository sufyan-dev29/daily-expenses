import type { SqlDb, SqlValue } from './db.ts';
import { fromMinor, parseAmountSigned, toMinor } from './money.ts';
import { uuid } from './uuid.ts';

export const CSV_LIMITS = { maxBytes: 5_000_000, maxRows: 50_000, maxName: 200, maxNotes: 2000, maxOption: 80 };

export class CsvError extends Error {}

// ------------------------------------------------------------------ parsing

/** RFC 4180 parser: quoted fields, "" escapes, embedded newlines, CR / LF / CRLF, UTF-8 BOM. */
export function parseCsv(input: string, delimiter?: string): { rows: string[][]; delimiter: string } {
  if (input.length > CSV_LIMITS.maxBytes) throw new CsvError('This file is too large to import (limit 5 MB).');
  const text = input.charCodeAt(0) === 0xfeff ? input.slice(1) : input;
  const delim = delimiter ?? detectDelimiter(text);
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  let sawQuote = false;
  let i = 0;
  const endField = () => { row.push(field); field = ''; sawQuote = false; };
  const endRow = () => {
    endField();
    if (!(row.length === 1 && row[0] === '' )) rows.push(row);
    row = [];
    if (rows.length > CSV_LIMITS.maxRows + 1) throw new CsvError(`Too many rows (limit ${CSV_LIMITS.maxRows}).`);
  };
  while (i < text.length) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i += 2; continue; }
        quoted = false; i++; continue;
      }
      field += ch; i++; continue;
    }
    if (ch === '"' && field === '' && !sawQuote) { quoted = true; sawQuote = true; i++; continue; }
    if (ch === delim) { endField(); i++; continue; }
    if (ch === '\r') { endRow(); i += text[i + 1] === '\n' ? 2 : 1; continue; }
    if (ch === '\n') { endRow(); i++; continue; }
    field += ch; i++;
  }
  if (quoted) throw new CsvError('The file has an opening quote that is never closed.');
  if (field !== '' || row.length > 0) endRow();
  return { rows, delimiter: delim };
}

function detectDelimiter(text: string): string {
  const firstLine = (text.split(/\r\n|\n|\r/).find((l) => l.trim() !== '') ?? '');
  let best = ',';
  let bestCount = 0;
  for (const d of [',', ';', '\t', '|']) {
    let count = 0;
    let inQ = false;
    for (const ch of firstLine) {
      if (ch === '"') inQ = !inQ;
      else if (!inQ && ch === d) count++;
    }
    if (count > bestCount) { best = d; bestCount = count; }
  }
  return best;
}

// ------------------------------------------------------------------ writing

/** One CSV field. Neutralises spreadsheet formula injection (=, +, -, @, tab, CR) by prefixing a quote. */
export function csvField(v: unknown): string {
  const s = v === null || v === undefined ? '' : String(v);
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export const CSV_HEADERS = ['Date', 'Description', 'Category', 'Amount', 'Payment Mode', 'Bank Name', 'Type', 'Notes', 'Entry', 'ID'] as const;

export interface ExportFilter { from?: string; to?: string; kind?: 'expense' | 'income' }

/** Same columns as the web app's export, so files move between the two. */
export async function exportCsv(db: SqlDb, f: ExportFilter = {}): Promise<string> {
  const where = ['t.deleted_at IS NULL'];
  const params: SqlValue[] = [];
  if (f.from) { where.push('t.occurred_on >= ?'); params.push(f.from); }
  if (f.to) { where.push('t.occurred_on <= ?'); params.push(f.to); }
  if (f.kind) { where.push('t.kind = ?'); params.push(f.kind); }
  const rows = await db.all<{
    occurred_on: string; name: string; kind: string; amount_minor: number; need_want: string | null; notes: string | null; id: string;
    category: string | null; source: string | null; bank: string | null; mode: string | null;
  }>(
    `SELECT t.occurred_on, t.name, t.kind, t.amount_minor, t.need_want, t.notes, t.id,
            c.name AS category, s.name AS source, b.name AS bank, m.name AS mode
       FROM transactions t
       LEFT JOIN options c ON c.id = t.category_id
       LEFT JOIN options s ON s.id = t.income_source_id
       LEFT JOIN options b ON b.id = t.bank_id
       LEFT JOIN options m ON m.id = t.payment_mode_id
      WHERE ${where.join(' AND ')}
      ORDER BY t.occurred_on, t.created_at, t.id`,
    params,
  );
  const lines = [CSV_HEADERS.join(',')];
  for (const r of rows) {
    lines.push(
      [
        r.occurred_on, r.name, r.kind === 'income' ? r.source : r.category, fromMinor(r.amount_minor), r.mode, r.bank,
        r.need_want ? (r.need_want === 'need' ? 'Need' : 'Want') : '', r.notes, r.kind === 'income' ? 'Income' : 'Expense', r.id,
      ].map(csvField).join(','),
    );
  }
  return lines.join('\n');
}

// ------------------------------------------------------------------ dates

export type DateOrder = 'dmy' | 'mdy';

const MONTHS: Record<string, number> = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4, may: 5, jun: 6, june: 6,
  jul: 7, july: 7, aug: 8, august: 8, sep: 9, sept: 9, september: 9, oct: 10, october: 10, nov: 11, november: 11, dec: 12, december: 12,
};

function validDate(y: number, m: number, d: number): string | null {
  if (y < 1970 || y > 2100 || m < 1 || m > 12 || d < 1 || d > 31) return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}
const year2 = (y: number) => (y < 100 ? (y < 70 ? 2000 + y : 1900 + y) : y);

/** Returns YYYY-MM-DD or null. Handles ISO, D/M/Y, M/D/Y (by `order`), "Thu, 10 Sep 2026", "Sep 10, 2026" and Excel serials. */
export function parseDate(raw: string, order: DateOrder = 'dmy'): string | null {
  let s = raw.trim();
  if (!s) return null;
  let m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[T\s].*)?$/);
  if (m) return validDate(+m[1], +m[2], +m[3]);
  m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2}|\d{4})(?:[T\s,].*)?$/);
  if (m) {
    const [a, b, y] = [+m[1], +m[2], year2(+m[3])];
    return order === 'dmy' ? validDate(y, b, a) : validDate(y, a, b);
  }
  s = s.replace(/^(?:mon|tue|tues|wed|thu|thur|thurs|fri|sat|sun)[a-z]*\.?,?\s+(?=\d)/i, ''); // drop a leading weekday: "Thu, 10 Sep 2026"
  m = s.match(/^(\d{1,2})(?:st|nd|rd|th)?[\s-]+([A-Za-z]{3,9})\.?,?[\s-]+(\d{2}|\d{4})(?:\s.*)?$/);
  if (m && MONTHS[m[2].toLowerCase()]) return validDate(year2(+m[3]), MONTHS[m[2].toLowerCase()], +m[1]);
  m = s.match(/^([A-Za-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{2}|\d{4})(?:\s.*)?$/);
  if (m && MONTHS[m[1].toLowerCase()]) return validDate(year2(+m[3]), MONTHS[m[1].toLowerCase()], +m[2]);
  if (/^\d{5}(\.\d+)?$/.test(s)) {
    const serial = Math.floor(Number(s));
    if (serial >= 25569 && serial <= 73050) {
      const d = new Date(Date.UTC(1899, 11, 30) + serial * 86400000);
      return validDate(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
    }
  }
  return null;
}

function detectDateOrder(values: string[], fallback: DateOrder): DateOrder {
  let sawFirstOver12 = false;
  let sawSecondOver12 = false;
  for (const v of values) {
    const m = v.trim().match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2}|\d{4})/);
    if (!m) continue;
    if (+m[1] > 12) sawFirstOver12 = true;
    if (+m[2] > 12) sawSecondOver12 = true;
  }
  if (sawFirstOver12 && !sawSecondOver12) return 'dmy';
  if (sawSecondOver12 && !sawFirstOver12) return 'mdy';
  return fallback;
}

// ------------------------------------------------------------------ column detection

export type Role = 'date' | 'description' | 'category' | 'amount' | 'mode' | 'bank' | 'type' | 'notes' | 'entry' | 'id';
export const ROLES: Role[] = ['date', 'description', 'category', 'amount', 'mode', 'bank', 'type', 'notes', 'entry', 'id'];
export type ColumnMap = Record<Role, number | null>;

const SYNONYMS: Record<Role, string[]> = {
  date: ['date', 'day', 'transactiondate', 'occurredon', 'when', 'datetime'],
  description: ['description', 'name', 'title', 'item', 'details', 'detail', 'memo', 'payee', 'narration', 'particulars'],
  category: ['category', 'categoryname', 'source', 'incomesource', 'group', 'head'],
  amount: ['amount', 'amt', 'value', 'total', 'price', 'cost', 'sum'],
  mode: ['paymentmode', 'mode', 'paymentmethod', 'method', 'paidby', 'paidvia'],
  bank: ['bankname', 'bank', 'account', 'accountname', 'wallet'],
  type: ['type', 'needwant', 'need/want', 'needorwant', 'priority'],
  notes: ['notes', 'note', 'remarks', 'remark', 'comment', 'comments'],
  entry: ['entry', 'kind', 'transactiontype', 'entrytype', 'incomeexpense', 'direction'],
  id: ['id', 'uuid', 'entryid', 'transactionid'],
};
const normHeader = (h: string) => h.normalize('NFKC').toLowerCase().replace(/[^a-z0-9/]/g, '');
const DEFAULT_ORDER: Role[] = ['date', 'description', 'category', 'amount', 'mode', 'bank', 'type', 'notes'];

const NEEDWANT: Record<string, 'need' | 'want'> = { need: 'need', needs: 'need', essential: 'need', want: 'want', wants: 'want', luxury: 'want' };
const ENTRY: Record<string, 'income' | 'expense'> = {
  income: 'income', credit: 'income', cr: 'income', in: 'income', deposit: 'income', earning: 'income', salary: 'income',
  expense: 'expense', debit: 'expense', dr: 'expense', out: 'expense', spend: 'expense', spent: 'expense', payment: 'expense',
};

export function detectColumns(rows: string[][]): { map: ColumnMap; hasHeader: boolean } {
  const map = Object.fromEntries(ROLES.map((r) => [r, null])) as ColumnMap;
  const head = rows[0] ?? [];
  const found: [Role, number][] = [];
  head.forEach((h, idx) => {
    const n = normHeader(h);
    for (const role of ROLES) if (SYNONYMS[role].includes(n)) { found.push([role, idx]); break; }
  });
  const hasHeader = found.length >= 2 || (found.length === 1 && head.length <= 3);
  if (!hasHeader) {
    DEFAULT_ORDER.forEach((role, idx) => { if (idx < (head.length || 0)) map[role] = idx; });
    return { map, hasHeader: false };
  }
  for (const [role, idx] of found) if (map[role] === null) map[role] = idx;
  // "Type" is Need/Want in the old sheet but Income/Expense in many bank exports: decide by content.
  if (map.type !== null && map.entry === null) {
    const vals = rows.slice(1, 400).map((r) => (r[map.type!] ?? '').trim().toLowerCase()).filter(Boolean);
    if (vals.length && vals.every((v) => v in ENTRY) && !vals.some((v) => v in NEEDWANT)) { map.entry = map.type; map.type = null; }
  }
  return { map, hasHeader: true };
}

// ------------------------------------------------------------------ planning an import

export type OptKind = 'category' | 'income_source' | 'bank' | 'payment_mode';
export interface ImportOptions {
  /** 'auto' uses the Entry column and falls back to `defaultKind`. */
  kind: 'expense' | 'income' | 'auto';
  defaultKind?: 'expense' | 'income';
  skipDuplicates?: boolean;
  dateOrder?: DateOrder;
  /** Overrides detection, e.g. when the user remaps columns in the preview. */
  columns?: Partial<ColumnMap>;
}

export interface PlannedRow {
  line: number; id: string; kind: 'expense' | 'income'; on: string; name: string; minor: number;
  category: string | null; bank: string | null; mode: string | null; nw: 'need' | 'want' | null; notes: string | null;
}
export interface OptionUse { kind: OptKind; name: string; count: number }

export interface ImportPlan {
  rows: PlannedRow[];
  newOptions: OptionUse[];
  matchedOptions: OptionUse[];
  reactivated: number;
  duplicates: number;
  errors: { line: number; reason: string }[];
  errorCount: number;
  warnings: string[];
  detected: { delimiter: string; hasHeader: boolean; columns: ColumnMap; dateOrder: DateOrder };
  totalRead: number;
}

export const normName = (s: string) => s.normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase();
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const unquoteFormula = (s: string) => (/^'[=+\-@\t\r]/.test(s) ? s.slice(1) : s);

export async function planImport(db: SqlDb, text: string, opts: ImportOptions): Promise<ImportPlan> {
  const { rows: all, delimiter } = parseCsv(text);
  if (all.length === 0) throw new CsvError('The file is empty.');
  const { map: detected, hasHeader } = detectColumns(all);
  const map = { ...detected, ...opts.columns } as ColumnMap;
  if (map.date === null || map.amount === null) {
    throw new CsvError('Could not find a Date column and an Amount column. Check that the first row has headers such as "Date" and "Amount".');
  }
  const body = hasHeader ? all.slice(1) : all;
  const cell = (r: string[], role: Role) => (map[role] === null ? '' : unquoteFormula((r[map[role]!] ?? '').trim()));

  const dateOrder = opts.dateOrder ?? detectDateOrder(body.map((r) => cell(r, 'date')), 'dmy');
  const errors: { line: number; reason: string }[] = [];
  let errorCount = 0;
  const fail = (line: number, reason: string) => { errorCount++; if (errors.length < 200) errors.push({ line, reason }); };
  const warnings = new Set<string>();

  // Existing options, matched by normalised name.
  const existing = await db.all<{ id: string; kind: OptKind; name: string; archived_at: string | null }>('SELECT id, kind, name, archived_at FROM options');
  const optIndex = new Map<string, { id: string; name: string; archived: boolean }>();
  for (const o of existing) optIndex.set(`${o.kind}|${normName(o.name)}`, { id: o.id, name: o.name, archived: !!o.archived_at });

  const planned: PlannedRow[] = [];
  let negatives = 0;
  const fileIds = new Set<string>();

  /** Cleans a list name (spacing, length). Whether it is new or existing is worked out later, from the rows that are kept. */
  const useOption = (_kind: OptKind, raw: string): string | null => {
    let name = raw.trim().replace(/\s+/g, ' ');
    if (!name) return null;
    if (name.length > CSV_LIMITS.maxOption) { name = name.slice(0, CSV_LIMITS.maxOption); warnings.add(`Long list names were shortened to ${CSV_LIMITS.maxOption} characters.`); }
    return name;
  };

  body.forEach((r, idx) => {
    const line = idx + 1 + (hasHeader ? 1 : 0);
    if (r.every((c) => c.trim() === '')) return;
    const on = parseDate(cell(r, 'date'), dateOrder);
    if (!on) return fail(line, cell(r, 'date') ? `Unreadable date "${cell(r, 'date').slice(0, 40)}"` : 'Missing date');
    const amountRaw = parseAmountSigned(cell(r, 'amount'));
    if (amountRaw === null) return fail(line, cell(r, 'amount') ? `Unreadable amount "${cell(r, 'amount').slice(0, 40)}"` : 'Missing amount');
    if (amountRaw < 0) negatives++;
    let minor: number;
    try { minor = toMinor(Math.abs(amountRaw)); } catch { return fail(line, 'Invalid amount'); }
    if (minor <= 0) return fail(line, 'Amount rounds to zero');
    if (minor > 100_000_000_000_00) return fail(line, 'Amount is too large');
    let name = cell(r, 'description').replace(/\s+/g, ' ');
    if (!name) return fail(line, 'Missing description');
    if (name.length > CSV_LIMITS.maxName) { name = name.slice(0, CSV_LIMITS.maxName); warnings.add(`Long descriptions were shortened to ${CSV_LIMITS.maxName} characters.`); }
    let notes: string | null = cell(r, 'notes') || null;
    if (notes && notes.length > CSV_LIMITS.maxNotes) { notes = notes.slice(0, CSV_LIMITS.maxNotes); warnings.add(`Long notes were shortened to ${CSV_LIMITS.maxNotes} characters.`); }

    let kind: 'expense' | 'income';
    if (opts.kind === 'auto') {
      const e = cell(r, 'entry').toLowerCase();
      if (e && !(e in ENTRY)) return fail(line, `Unknown entry type "${e.slice(0, 30)}" (use Income or Expense)`);
      kind = e ? ENTRY[e] : opts.defaultKind ?? 'expense';
    } else {
      kind = opts.kind;
    }

    const nwRaw = cell(r, 'type').toLowerCase();
    const nw = kind === 'expense' && nwRaw in NEEDWANT ? NEEDWANT[nwRaw] : null;
    const catName = cell(r, 'category');
    const idRaw = cell(r, 'id').toLowerCase();
    const id = UUID_RE.test(idRaw) && !fileIds.has(idRaw) ? idRaw : '';
    if (id) fileIds.add(id);

    planned.push({
      line, id, kind, on, name, minor,
      category: catName ? useOption(kind === 'income' ? 'income_source' : 'category', catName) : null,
      bank: cell(r, 'bank') ? useOption('bank', cell(r, 'bank')) : null,
      mode: cell(r, 'mode') ? useOption('payment_mode', cell(r, 'mode')) : null,
      nw, notes,
    });
  });
  if (negatives) warnings.add(`${negatives} negative amount${negatives === 1 ? '' : 's'} imported as positive.`);

  // Duplicates: against existing, non-trashed rows of the same dates (as a multiset), and by id.
  let duplicates = 0;
  let kept = planned;
  if (opts.skipDuplicates !== false && planned.length) {
    const dates = planned.map((p) => p.on).sort();
    const have = await db.all<{ id: string; kind: string; occurred_on: string; name: string; amount_minor: number; deleted_at: string | null }>(
      'SELECT id, kind, occurred_on, name, amount_minor, deleted_at FROM transactions WHERE occurred_on BETWEEN ? AND ?',
      [dates[0], dates[dates.length - 1]],
    );
    const ids = new Set((await db.all<{ id: string }>('SELECT id FROM transactions')).map((x) => x.id));
    const counts = new Map<string, number>();
    for (const h of have) if (!h.deleted_at) { const k = `${h.kind}|${h.occurred_on}|${normName(h.name)}|${h.amount_minor}`; counts.set(k, (counts.get(k) ?? 0) + 1); }
    kept = [];
    for (const p of planned) {
      const k = `${p.kind}|${p.on}|${normName(p.name)}|${p.minor}`;
      const n = counts.get(k) ?? 0;
      if ((p.id && ids.has(p.id)) || n > 0) { if (n > 0 && !(p.id && ids.has(p.id))) counts.set(k, n - 1); duplicates++; } else kept.push(p);
    }
  } else if (planned.length) {
    const ids = new Set((await db.all<{ id: string }>('SELECT id FROM transactions')).map((x) => x.id));
    for (const p of planned) if (p.id && ids.has(p.id)) p.id = '';
  }

  // Options only count when the row that uses them is kept; recompute from kept rows.
  const finalNew = new Map<string, OptionUse>();
  const finalMatched = new Map<string, OptionUse>();
  const reactivated = new Set<string>();
  const tally = (kind: OptKind, name: string | null) => {
    if (!name) return;
    const key = `${kind}|${normName(name)}`;
    const hit = optIndex.get(key);
    if (hit) {
      const u = finalMatched.get(key) ?? { kind, name: hit.name, count: 0 }; u.count++; finalMatched.set(key, u);
      if (hit.archived) reactivated.add(hit.id);
    } else {
      const u = finalNew.get(key) ?? { kind, name, count: 0 }; u.count++; finalNew.set(key, u);
    }
  };
  for (const p of kept) {
    tally(p.kind === 'income' ? 'income_source' : 'category', p.category);
    tally('bank', p.bank);
    tally('payment_mode', p.mode);
  }

  return {
    rows: kept,
    newOptions: [...finalNew.values()],
    matchedOptions: [...finalMatched.values()],
    reactivated: reactivated.size,
    duplicates,
    errors,
    errorCount,
    warnings: [...warnings],
    detected: { delimiter, hasHeader, columns: map, dateOrder },
    totalRead: body.filter((r) => !r.every((c) => c.trim() === '')).length,
  };
}

export interface ImportResult { inserted: number; createdOptions: number; reactivated: number; skippedDuplicates: number; errorCount: number }

/** Writes a plan in one transaction: either everything is imported or nothing is. */
export async function applyImport(db: SqlDb, plan: ImportPlan): Promise<ImportResult> {
  return db.transaction(async () => {
    const existing = await db.all<{ id: string; kind: OptKind; name: string; archived_at: string | null }>('SELECT id, kind, name, archived_at FROM options');
    const idOf = new Map<string, string>();
    for (const o of existing) idOf.set(`${o.kind}|${normName(o.name)}`, o.id);
    const orders = new Map<string, number>();
    for (const row of await db.all<{ kind: string; m: number }>('SELECT kind, coalesce(max(sort_order), 0) AS m FROM options GROUP BY kind')) orders.set(row.kind, row.m);

    for (const n of plan.newOptions) {
      const key = `${n.kind}|${normName(n.name)}`;
      if (idOf.has(key)) continue;
      const id = uuid();
      const order = (orders.get(n.kind) ?? 0) + 1;
      orders.set(n.kind, order);
      await db.run('INSERT INTO options (id, kind, name, sort_order) VALUES (?,?,?,?)', [id, n.kind, n.name, order]);
      idOf.set(key, id);
    }
    // Options that were archived but are used again come back.
    const used = new Set<string>();
    for (const p of plan.rows) {
      for (const [kind, name] of [[p.kind === 'income' ? 'income_source' : 'category', p.category], ['bank', p.bank], ['payment_mode', p.mode]] as [OptKind, string | null][]) {
        if (name) { const id = idOf.get(`${kind}|${normName(name)}`); if (id) used.add(id); }
      }
    }
    let reactivated = 0;
    for (const id of used) {
      const r = await db.run('UPDATE options SET archived_at = NULL WHERE id = ? AND archived_at IS NOT NULL', [id]);
      reactivated += r.changes;
    }

    const take = (kind: OptKind, name: string | null) => (name ? idOf.get(`${kind}|${normName(name)}`) ?? null : null);
    const sets: SqlValue[][] = plan.rows.map((p) => [
      p.id || uuid(), p.kind, p.name, p.minor, p.on,
      p.kind === 'expense' ? take('category', p.category) : null,
      take('bank', p.bank), take('payment_mode', p.mode),
      p.kind === 'income' ? take('income_source', p.category) : null,
      p.nw, p.notes,
    ]);
    const sql = `INSERT INTO transactions (id, kind, name, amount_minor, occurred_on, category_id, bank_id, payment_mode_id, income_source_id, need_want, notes)
                 VALUES (?,?,?,?,?,?,?,?,?,?,?)`;
    for (let i = 0; i < sets.length; i += 500) await db.runMany(sql, sets.slice(i, i + 500));
    return { inserted: sets.length, createdOptions: plan.newOptions.length, reactivated, skippedDuplicates: plan.duplicates, errorCount: plan.errorCount };
  });
}
