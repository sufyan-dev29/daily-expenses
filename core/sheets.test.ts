import { test } from 'node:test';
import assert from 'node:assert/strict';
import { memoryDb } from './test-db.ts';
import { migrate } from './schema.ts';
import { localClient } from './localclient.ts';
import { setSecret, getSecret, GOOGLE_KEY, NEEDS_FULL_RESYNC } from './secrets.ts';
import { SHEET_HEADERS, SheetsClient, parseServiceAccount, parseSpreadsheetId, runSync, safeCell, testConnection, type FetchLike } from './sheets.ts';
import { fromBase64, utf8 } from './bytes.ts';

const SID = 'sheet-id-1234567890abcdef';
const TAB = 'Expenses';

async function makeKey() {
  const kp = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
  const pkcs8 = Buffer.from(await crypto.subtle.exportKey('pkcs8', kp.privateKey)).toString('base64').match(/.{1,64}/g)!.join('\n');
  const json = JSON.stringify({ type: 'service_account', client_email: 'bot@proj.iam.gserviceaccount.com', private_key: `-----BEGIN PRIVATE KEY-----\n${pkcs8}\n-----END PRIVATE KEY-----\n`, token_uri: 'https://oauth2.googleapis.com/token' });
  return { json, pub: kp.publicKey };
}

/** Minimal in-memory Google: token endpoint + the Sheets calls the app makes. */
class FakeGoogle {
  rows: string[][] = []; // row 1 = index 0
  formulas = 0;
  tokens = 0;
  online = true;
  failNext: { status: number; times: number } | null = null;
  expireTokens = 0;
  calls: string[] = [];
  onAppend: (() => Promise<void>) | null = null;
  tabs = [TAB];
  allowed = true;
  pub: CryptoKey;
  constructor(pub: CryptoKey) { this.pub = pub; }

  fetch: FetchLike = async (url, init) => {
    if (!this.online) throw new TypeError('Failed to fetch');
    const method = init?.method ?? 'GET';
    const res = (status: number, body: unknown) => ({ ok: status < 300, status, json: async () => body, text: async () => JSON.stringify(body) });
    if (url === 'https://oauth2.googleapis.com/token') {
      const jwt = decodeURIComponent((init!.body as string).split('assertion=')[1]);
      const [h, c, s] = jwt.split('.');
      const ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', this.pub, fromBase64(s.replace(/-/g, '+').replace(/_/g, '/') + '=='.slice((s.length + 2) % 4 === 0 ? 0 : 0)) as BufferSource, utf8(`${h}.${c}`) as BufferSource).catch(() => false);
      const claim = JSON.parse(Buffer.from(c, 'base64url').toString());
      if (!ok || claim.iss !== 'bot@proj.iam.gserviceaccount.com' || claim.scope !== 'https://www.googleapis.com/auth/spreadsheets' || claim.aud !== 'https://oauth2.googleapis.com/token') return res(400, { error: 'invalid_grant', error_description: 'bad assertion' });
      this.tokens++;
      return res(200, { access_token: `tok${this.tokens}`, expires_in: 3600 });
    }
    const headers = init?.headers ?? {};
    if (this.expireTokens > 0) { this.expireTokens--; return res(401, { error: { message: 'expired' } }); }
    if (!/^Bearer tok\d+$/.test(headers.Authorization ?? '')) return res(401, { error: { message: 'no auth' } });
    if (this.failNext && this.failNext.times > 0) { this.failNext.times--; return res(this.failNext.status, { error: { message: 'boom' } }); }
    if (!this.allowed) return res(403, { error: { message: 'forbidden' } });
    const u = new URL(url);
    const path = decodeURIComponent(u.pathname).replace('/v4/spreadsheets/', '');
    this.calls.push(`${method} ${path.replace(SID, '$ID')}`);
    const body = init?.body ? JSON.parse(init.body) : undefined;
    const valueOf = (v: unknown): string => {
      let s = String(v);
      if (u.searchParams.get('valueInputOption') === 'USER_ENTERED' || body?.valueInputOption === 'USER_ENTERED') { if (s.startsWith("'")) s = s.slice(1); else if (s.startsWith('=')) this.formulas++; }
      return s;
    };
    if (path === SID && method === 'GET') return res(200, { sheets: this.tabs.map((t, i) => ({ properties: { title: t, sheetId: i + 1 } })) });
    if (path === `${SID}:batchUpdate`) {
      const dels = (body.requests as any[]).filter((r) => r.deleteDimension).map((r) => r.deleteDimension.range);
      for (const d of dels.sort((a, b) => b.startIndex - a.startIndex)) this.rows.splice(d.startIndex, d.endIndex - d.startIndex);
      return res(200, {});
    }
    if (path === `${SID}/values:batchUpdate`) {
      for (const d of body.data) { const m = /!A(\d+):J\d+$/.exec(d.range)!; this.rows[Number(m[1]) - 1] = d.values[0].map(valueOf); }
      return res(200, {});
    }
    const m = /^(.+?)\/values\/'(.+)'!(.+?)(:append|:clear)?$/.exec(path);
    if (!m || m[1] !== SID) return res(404, { error: { message: 'not found' } });
    if (!this.tabs.includes(m[2])) return res(400, { error: { message: `Unable to parse range: ${m[2]}` } });
    const range = m[3];
    if (m[4] === ':append') {
      if (this.onAppend) await this.onAppend();
      for (const r of body.values) this.rows.push(r.map(valueOf));
      return res(200, {});
    }
    if (m[4] === ':clear') { this.rows = this.rows.slice(0, 1); return res(200, {}); }
    if (method === 'GET') {
      if (range === 'A1:J1') return res(200, this.rows[0] ? { values: [this.rows[0]] } : {});
      if (range === 'J:J') return res(200, { values: this.rows.map((r) => [r[9] ?? '']) });
    }
    if (method === 'PUT' && range === 'A1:J1') { this.rows[0] = body.values[0]; return res(200, {}); }
    return res(400, { error: { message: 'unsupported in fake: ' + method + ' ' + range } });
  };
  body() { return this.rows.slice(1); }
}

async function setup(opts: { online?: boolean; connect?: boolean } = {}) {
  const db = await memoryDb(); await migrate(db);
  const c = localClient(db);
  const { json, pub } = await makeKey();
  const g = new FakeGoogle(pub);
  const deps = { fetch: g.fetch, sleep: async () => {} };
  await setSecret(db, GOOGLE_KEY, json);
  if (opts.online !== false) await c.from('user_settings').update({ mode: 'online', sheet: opts.connect === false ? null : { spreadsheetId: SID, tab: TAB } });
  const add = (id: string, name: string, amount: number, extra: Record<string, unknown> = {}) => c.from('transactions').upsert({ id, kind: 'expense', name, amount, occurred_on: '2026-06-01', ...extra }, { onConflict: 'id' });
  return { db, c, g, deps, add, json };
}
const ids = (g: FakeGoogle) => g.body().map((r) => r[9]).sort();

test('JWT is RS256-signed with the right claims and accepted; connecting writes the header row', async () => {
  const { db, g, deps, json } = await setup();
  const api = new SheetsClient(json, deps);
  await testConnection(api, { spreadsheetId: SID, tab: TAB });
  assert.deepEqual(g.rows[0], [...SHEET_HEADERS]);
  assert.equal(g.tokens, 1);
  void db;
});

test('connection errors are explained in plain words', async () => {
  const { g, deps, json } = await setup();
  const api = new SheetsClient(json, deps);
  g.tabs = ['Other'];
  await assert.rejects(() => testConnection(api, { spreadsheetId: SID, tab: TAB }), /Tab not found/);
  g.tabs = [TAB]; g.allowed = false;
  await assert.rejects(() => testConnection(api, { spreadsheetId: SID, tab: TAB }), /Share the sheet with the service account/);
});

test('entries sync: add, edit in place, trash removes, restore re-adds, delete removes; queue ends empty', async () => {
  const { db, c, g, deps, add } = await setup();
  await add('a', 'Rice', 100); await add('b', 'Milk', 50); await add('c', 'Bus', 20);
  let r = await runSync(db, deps);
  assert.equal(r.error, null);
  assert.deepEqual(ids(g), ['a', 'b', 'c']);
  assert.equal(g.rows[0].join(), SHEET_HEADERS.join());
  assert.equal((await db.all('SELECT * FROM sync_outbox')).length, 0);
  assert.ok((await db.all<{ s: string | null }>("SELECT sheet_synced_at s FROM transactions WHERE id='a'"))[0].s);

  await c.from('transactions').update({ name: 'Rice 5kg', amount: 111.5 }).eq('id', 'a');
  await runSync(db, deps);
  assert.equal(g.body().length, 3);
  assert.deepEqual(g.body().find((x) => x[9] === 'a')!.slice(0, 4), ['2026-06-01', 'Rice 5kg', '', '111.5']);

  await c.from('transactions').update({ deleted_at: new Date().toISOString() }).eq('id', 'b');
  await runSync(db, deps);
  assert.deepEqual(ids(g), ['a', 'c']);
  await c.from('transactions').update({ deleted_at: null }).eq('id', 'b');
  await runSync(db, deps);
  assert.deepEqual(ids(g), ['a', 'b', 'c']);
  await c.from('transactions').delete().eq('id', 'c');
  await runSync(db, deps);
  assert.deepEqual(ids(g), ['a', 'b']);
  assert.equal((await db.all('SELECT * FROM sync_outbox')).length, 0);
  const cfg = JSON.parse((await db.all<{ sheet: string }>('SELECT sheet FROM settings'))[0].sheet);
  assert.ok(cfg.lastSyncAt && cfg.lastError === null);
});

test('category, bank, mode and need/want land in the right columns; income uses its source', async () => {
  const { db, c, g, deps } = await setup();
  await c.from('options').insert({ id: 'cat', kind: 'category', name: 'Groceries' });
  await c.from('options').insert({ id: 'bk', kind: 'bank', name: 'HBL' });
  await c.from('options').insert({ id: 'pm', kind: 'payment_mode', name: 'Cash' });
  await c.from('options').insert({ id: 'src', kind: 'income_source', name: 'Salary' });
  await c.from('transactions').upsert({ id: 'e1', kind: 'expense', name: 'Rice', amount: 10, occurred_on: '2026-06-02', category_id: 'cat', bank_id: 'bk', payment_mode_id: 'pm', need_want: 'want', notes: 'n' }, { onConflict: 'id' });
  await c.from('transactions').upsert({ id: 'i1', kind: 'income', name: 'Pay', amount: 500, occurred_on: '2026-06-03', income_source_id: 'src' }, { onConflict: 'id' });
  await runSync(db, deps);
  assert.deepEqual(g.body().find((r) => r[9] === 'e1'), ['2026-06-02', 'Rice', 'Groceries', '10', 'Cash', 'HBL', 'Want', 'n', 'Expense', 'e1']);
  assert.deepEqual(g.body().find((r) => r[9] === 'i1'), ['2026-06-03', 'Pay', 'Salary', '500', '', '', '', '', 'Income', 'i1']);
});

test('no internet: nothing is lost or penalised; the next run (next app open with internet) catches up', async () => {
  const { db, c, g, deps, add } = await setup();
  g.online = false;
  await add('o1', 'Offline one', 10); await add('o2', 'Offline two', 20);
  await c.from('transactions').update({ amount: 25 }).eq('id', 'o2');
  const r = await runSync(db, deps);
  assert.equal(r.offline, true); assert.equal(r.error, null);
  const q = await db.all<{ transaction_id: string; attempts: number; last_error: string | null }>('SELECT transaction_id, attempts, last_error FROM sync_outbox ORDER BY id');
  assert.deepEqual(q.map((x) => [x.transaction_id, x.attempts, x.last_error]), [['o1', 0, null], ['o2', 0, null]]);
  const cfg = JSON.parse((await db.all<{ sheet: string }>('SELECT sheet FROM settings'))[0].sheet);
  assert.equal(cfg.lastError ?? null, null, 'being offline must not show an error');
  g.online = true;
  const r2 = await runSync(db, deps);
  assert.equal(r2.error, null);
  assert.deepEqual(ids(g), ['o1', 'o2']);
  assert.equal(g.body().find((x) => x[9] === 'o2')![3], '25');
  assert.equal((await db.all('SELECT * FROM sync_outbox')).length, 0);
});

test('server errors back off with a recorded reason, then recover; 5xx is retried first', async () => {
  const { db, g, deps, add } = await setup();
  await add('x1', 'One', 1);
  g.failNext = { status: 500, times: 2 }; // transient: succeeds on a retry inside one run
  assert.equal((await runSync(db, deps)).error, null);
  assert.deepEqual(ids(g), ['x1']);

  await add('x2', 'Two', 2);
  g.failNext = { status: 403, times: 99 };
  const r = await runSync(db, deps);
  assert.match(r.error!, /Share the sheet/);
  const job = (await db.all<{ attempts: number; last_error: string; next_attempt_at: string }>('SELECT attempts, last_error, next_attempt_at FROM sync_outbox'))[0];
  assert.equal(job.attempts, 1); assert.ok(new Date(job.next_attempt_at).getTime() > Date.now() + 60_000);
  const cfg = JSON.parse((await db.all<{ sheet: string }>('SELECT sheet FROM settings'))[0].sheet);
  assert.match(cfg.lastError, /Share the sheet/);
  assert.equal((await runSync(db, deps)).synced, 0, 'not due yet');
  g.failNext = null;
  const later = await runSync(db, { ...deps, now: () => Date.now() + 3 * 3600_000 });
  assert.equal(later.error, null);
  assert.deepEqual(ids(g), ['x1', 'x2']);
});

test('an expired token is refreshed once and the call retried', async () => {
  const { db, g, deps, add } = await setup();
  await add('t1', 'T', 1);
  g.expireTokens = 1;
  assert.equal((await runSync(db, deps)).error, null);
  assert.ok(g.tokens >= 2);
  assert.deepEqual(ids(g), ['t1']);
});

test('a change made while a sync is running is not lost', async () => {
  const { db, c, g, deps, add } = await setup();
  await add('r1', 'Before', 10);
  g.onAppend = async () => { g.onAppend = null; await c.from('transactions').update({ name: 'After' }).eq('id', 'r1'); };
  await runSync(db, deps);
  assert.equal(g.body()[0][1], 'Before');
  const left = await db.all<{ transaction_id: string }>('SELECT transaction_id FROM sync_outbox');
  assert.deepEqual(left.map((x) => x.transaction_id), ['r1'], 'newer change must stay queued');
  await runSync(db, deps);
  assert.equal(g.body()[0][1], 'After');
  assert.equal((await db.all('SELECT * FROM sync_outbox')).length, 0);
});

test('spreadsheet formulas in names and notes are written as plain text', async () => {
  const { db, g, deps, add } = await setup();
  await add('f1', '=HYPERLINK("http://evil","x")', 1, { notes: '+cmd|calc' });
  await add('f2', '-5 refund', 1, { notes: '@SUM(1)' });
  await add('f3', 'Normal', 1);
  await runSync(db, deps);
  assert.equal(g.formulas, 0);
  assert.equal(g.body().find((r) => r[9] === 'f1')![1], '=HYPERLINK("http://evil","x")');
  assert.equal(g.body().find((r) => r[9] === 'f2')![1], '-5 refund');
  assert.equal(safeCell('=1+1'), "'=1+1"); assert.equal(safeCell('plain'), 'plain'); assert.equal(safeCell('-x'), "'-x");
});

test('deleting many entries removes exactly the right rows (bottom-up) and cleans duplicates', async () => {
  const { db, c, g, deps, add } = await setup();
  for (let i = 0; i < 10; i++) await add(`d${i}`, `Item ${i}`, i + 1);
  await runSync(db, deps);
  g.rows.push([...g.rows[3]]); // simulate a stray duplicate of d2 in the sheet
  for (const i of [1, 3, 4, 8]) await c.from('transactions').delete().eq('id', `d${i}`);
  await c.from('transactions').update({ name: 'Item 2 edited' }).eq('id', 'd2');
  await runSync(db, deps);
  assert.deepEqual(ids(g), ['d0', 'd2', 'd5', 'd6', 'd7', 'd9']);
  assert.equal(g.body().filter((r) => r[9] === 'd2').length, 1);
  assert.equal(g.body().find((r) => r[9] === 'd2')![1], 'Item 2 edited');
});

test('full resync rewrites the sheet from the database (skips trash, pages past 1000)', async () => {
  const { db, c, g, deps, add } = await setup();
  await db.transaction(async () => { await db.runMany('INSERT INTO transactions (id, kind, name, amount_minor, occurred_on) VALUES (?,?,?,?,?)', Array.from({ length: 2300 }, (_, i) => [`b${i}`, 'expense', `Bulk ${i}`, 100 + i, '2026-01-01'])); });
  await add('trash1', 'Trashed', 5);
  await c.from('transactions').update({ deleted_at: new Date().toISOString() }).eq('id', 'trash1');
  g.rows = [[...SHEET_HEADERS], ['junk'], ['junk2']];
  const r = await runSync(db, deps, { full: true });
  assert.equal(r.total, 2300);
  assert.equal(g.body().length, 2300);
  assert.ok(!g.body().some((x) => x[9] === 'trash1' || x[0] === 'junk'));
  assert.equal((await db.all('SELECT * FROM sync_outbox')).length, 0);
  assert.equal((await db.all<{ n: number }>('SELECT count(*) n FROM transactions WHERE sheet_synced_at IS NOT NULL'))[0].n, 2300);
});

test('going from offline to online with a sheet already set up triggers a full resync flag path', async () => {
  const { db, c, g, deps, add } = await setup({ online: false });
  await c.from('user_settings').update({ sheet: { spreadsheetId: SID, tab: TAB } });
  await add('p1', 'Made offline', 10);
  assert.equal((await runSync(db, deps)).skipped, 'offline-mode');
  assert.equal(g.rows.length, 0);
  await c.from('user_settings').update({ mode: 'online' });
  await setSecret(db, NEEDS_FULL_RESYNC, '1');
  const r = await runSync(db, deps);
  assert.equal(r.total, 1);
  assert.deepEqual(ids(g), ['p1']);
  assert.equal(await getSecret(db, NEEDS_FULL_RESYNC), null);
});

test('skips cleanly with no sheet, no key; bad inputs are rejected with clear messages', async () => {
  const a = await setup({ connect: false });
  assert.equal((await runSync(a.db, a.deps)).skipped, 'no-sheet');
  const b = await setup();
  await b.db.run('DELETE FROM secrets');
  assert.equal((await runSync(b.db, b.deps)).skipped, 'no-key');
  assert.throws(() => parseServiceAccount('nope'), /not valid JSON/);
  assert.throws(() => parseServiceAccount('{"type":"authorized_user"}'), /does not look like/);
  assert.equal(parseSpreadsheetId('https://docs.google.com/spreadsheets/d/abc_DEF-123/edit#gid=0'), 'abc_DEF-123');
  assert.equal(parseSpreadsheetId('https://evil.example/'), null);
});

test('a wrong signature or key makes Google sign-in fail with a readable error (no crash, queue kept)', async () => {
  const { db, g, add } = await setup();
  await add('k1', 'K', 1);
  const other = await makeKey(); // key that the fake does not trust
  await setSecret(db, GOOGLE_KEY, other.json);
  const r = await runSync(db, { fetch: g.fetch, sleep: async () => {} });
  assert.match(r.error!, /Google sign-in failed/);
  assert.equal((await db.all('SELECT * FROM sync_outbox')).length, 1);
});
