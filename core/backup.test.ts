import { test } from 'node:test';
import assert from 'node:assert/strict';
import { memoryDb } from './test-db.ts';
import { migrate } from './schema.ts';
import { applyImport, planImport } from './csv.ts';
import { BackupError, collectData, createBackup, openBackup, readHeader, restoreData, validateData } from './backup.ts';
import { unzip, zip } from './zip.ts';
import { fromUtf8, utf8 } from './bytes.ts';
import { getSecret, GOOGLE_KEY, NEEDS_FULL_RESYNC, setSecret } from './secrets.ts';

const FAST = { iterations: 100_000 };
const KEY = JSON.stringify({ client_email: 'sa@p.iam.gserviceaccount.com', private_key: '-----BEGIN PRIVATE KEY-----\nSECRETSECRET\n-----END PRIVATE KEY-----\n' });

async function seeded() {
  const db = await memoryDb(); await migrate(db);
  const csv = 'Date,Description,Category,Amount,Payment Mode,Bank Name,Type,Notes\n2026-01-05,Rice,Groceries,"1,200.50",Cash,HBL,Need,"weekly, bulk"\n2026-01-06,Uber ride,Transport,450,Card,Meezan,Want,\n';
  await applyImport(db, await planImport(db, csv, { kind: 'expense' }));
  await db.run("UPDATE settings SET mode='online', accent_hex='#AA3300', theme_mode='dark', currency='USD', sheet=? WHERE id=1", [JSON.stringify({ spreadsheetId: 'abc123', tab: 'Data' })]);
  await db.run("INSERT INTO templates (id, kind, name, behavior, payload) VALUES ('t1','expense','Lunch','instant','{\"name\":\"Lunch\"}')");
  await db.run("UPDATE transactions SET deleted_at='2026-02-01T00:00:00.000Z' WHERE name='Uber ride'");
  return db;
}
const snapshot = async (db: any) => ({
  s: await db.all('SELECT mode, theme_mode, accent_hex, currency, locale, week_start, sheet FROM settings'),
  o: await db.all('SELECT id, kind, name, archived_at FROM options ORDER BY id'),
  t: await db.all('SELECT id, kind, name, amount_minor, occurred_on, category_id, bank_id, payment_mode_id, need_want, notes, deleted_at FROM transactions ORDER BY id'),
  p: await db.all('SELECT id, kind, name, behavior, payload FROM templates ORDER BY id'),
});

test('backup of a full account restores identically into a fresh database (incl. trash, templates, settings, key)', async () => {
  const src = await seeded();
  const file = await createBackup(await collectData(src, { username: 'sufyan' }, KEY), 'correct horse', FAST);
  const { header, data } = await openBackup(file, 'correct horse');
  assert.equal(header.counts.transactions, 2);
  assert.equal(data.serviceAccountKey, KEY);
  assert.equal(data.account.username, 'sufyan');
  const dst = await memoryDb(); await migrate(dst);
  const r = await restoreData(dst, data, 'replace');
  assert.equal(r.transactionsAdded, 2);
  assert.deepEqual(await snapshot(dst), await snapshot(src));
  assert.equal((await dst.all('SELECT * FROM sync_outbox')).length, 0, 'restore must not queue every row for sync');
});

test('file is a zip with manifest.json and does not contain plaintext secrets or data', async () => {
  const src = await seeded();
  const file = await createBackup(await collectData(src, { username: 'sufyan' }, KEY), 'correct horse', FAST);
  const entries = await unzip(file);
  assert.deepEqual(entries.map((e) => e.name), ['manifest.json']);
  const text = fromUtf8(entries[0].data);
  for (const secret of ['SECRETSECRET', 'Rice', 'HBL', 'sufyan', 'abc123']) assert.ok(!text.includes(secret), secret);
  assert.ok(!Buffer.from(file).includes('SECRETSECRET'));
  assert.equal((await readHeader(file)).counts.options, 6);
});

test('wrong password, tampered ciphertext and tampered header are all refused', async () => {
  const src = await seeded();
  const file = await createBackup(await collectData(src, { username: 'u' }, null), 'correct horse', FAST);
  await assert.rejects(() => openBackup(file, 'wrong password'), (e: any) => e instanceof BackupError && e.code === 'wrong_password');
  const m = JSON.parse(fromUtf8((await unzip(file))[0].data));
  const rewrap = (mut: (x: any) => void) => { const c = structuredClone(m); mut(c); return zip([{ name: 'manifest.json', data: utf8(JSON.stringify(c)) }]); };
  const ct = Buffer.from(m.ciphertext, 'base64'); ct[10] ^= 1;
  await assert.rejects(async () => openBackup(await rewrap((x) => { x.ciphertext = ct.toString('base64'); }), 'correct horse'), (e: any) => e.code === 'wrong_password');
  await assert.rejects(async () => openBackup(await rewrap((x) => { x.counts.transactions = 1; }), 'correct horse'), (e: any) => e.code === 'wrong_password');
  await assert.rejects(async () => openBackup(await rewrap((x) => { x.createdAt = '2020-01-01T00:00:00.000Z'; }), 'correct horse'), (e: any) => e.code === 'wrong_password');
  await assert.rejects(async () => openBackup(await rewrap((x) => { x.encryption.iterations = 100_001; }), 'correct horse'), (e: any) => e.code === 'wrong_password');
});

test('hostile manifests: wrong format, newer version, absurd KDF cost, junk, short password', async () => {
  const wrap = (o: unknown) => zip([{ name: 'manifest.json', data: utf8(JSON.stringify(o)) }]);
  const src = await seeded();
  const good = JSON.parse(fromUtf8((await unzip(await createBackup(await collectData(src, { username: 'u' }, null), 'correct horse', FAST)))[0].data));
  await assert.rejects(async () => openBackup(await wrap({ format: 'nope' }), 'x'), BackupError);
  await assert.rejects(async () => openBackup(await wrap({ ...good, version: 99 }), 'x'), (e: any) => e.code === 'too_new');
  await assert.rejects(async () => openBackup(await wrap({ ...good, schemaVersion: 99 }), 'x'), (e: any) => e.code === 'too_new');
  const t0 = Date.now();
  await assert.rejects(async () => openBackup(await wrap({ ...good, encryption: { ...good.encryption, iterations: 2_000_000_000 } }), 'x'), BackupError);
  assert.ok(Date.now() - t0 < 2000, 'must reject absurd KDF cost before deriving');
  await assert.rejects(async () => openBackup(await zip([{ name: 'other.json', data: utf8('{}') }]), 'x'), BackupError);
  await assert.rejects(async () => openBackup(await zip([{ name: 'manifest.json', data: utf8('not json') }]), 'x'), BackupError);
  await assert.rejects(async () => openBackup(utf8('random bytes that are not a zip'), 'x'), BackupError);
  await assert.rejects(async () => createBackup(await collectData(src, { username: 'u' }, null), 'short', FAST), (e: any) => e.code === 'weak_password');
});

test('validateData rejects bad rows and dangling references', async () => {
  const src = await seeded();
  const good = JSON.parse(JSON.stringify(await collectData(src, { username: 'u' }, KEY)));
  assert.doesNotThrow(() => validateData(good));
  const cases: Array<[string, (d: any) => void]> = [
    ['zero amount', (d) => { d.transactions[0].amount_minor = 0; }],
    ['float amount', (d) => { d.transactions[0].amount_minor = 1.5; }],
    ['bad date', (d) => { d.transactions[0].occurred_on = '2026-02-31'; }],
    ['bad kind', (d) => { d.transactions[0].kind = 'transfer'; }],
    ['dangling category', (d) => { d.transactions[0].category_id = 'nope'; }],
    ['category pointing at a bank', (d) => { d.transactions[0].category_id = d.transactions[0].bank_id; }],
    ['duplicate tx id', (d) => { d.transactions[1].id = d.transactions[0].id; }],
    ['duplicate option name', (d) => { d.options[1].name = d.options[0].name.toUpperCase(); d.options[1].kind = d.options[0].kind; }],
    ['sql in id', (d) => { d.transactions[0].id = "x'; DROP TABLE transactions;--"; }],
    ['bad key', (d) => { d.serviceAccountKey = '{"client_email":1}'; }],
    ['bad mode', (d) => { d.settings.mode = 'cloud'; }],
    ['bad accent', (d) => { d.settings.accent_hex = 'red'; }],
    ['settings missing', (d) => { delete d.settings; }],
    ['huge name', (d) => { d.transactions[0].name = 'x'.repeat(501); }],
    ['non-array', (d) => { d.templates = {}; }],
  ];
  for (const [label, mut] of cases) { const d = structuredClone(good); mut(d); assert.throws(() => validateData(d), BackupError, label); }
});

test('restore (replace) is atomic: a failure midway leaves the existing data untouched', async () => {
  const src = await seeded();
  const data = await collectData(src, { username: 'u' }, null);
  const dst = await seeded();
  const before = await snapshot(dst);
  const broken = structuredClone(data);
  broken.templates.push({ ...broken.templates[0], id: 't2' }, { ...broken.templates[0], id: 't2' }); // duplicate PK passes no validation here on purpose
  await assert.rejects(() => restoreData(dst, broken, 'replace'));
  assert.deepEqual(await snapshot(dst), before);
});

test('merge adds missing data, maps options by name, keeps existing settings, skips known ids', async () => {
  const a = await seeded();
  const data = await collectData(a, { username: 'u' }, null);
  const b = await memoryDb(); await migrate(b);
  await b.run("INSERT INTO options (id, kind, name) VALUES ('existing-cat','category','groceries')"); // same name, different case/id
  await b.run("UPDATE settings SET currency='EUR'");
  const r1 = await restoreData(b, data, 'merge');
  assert.equal(r1.transactionsAdded, 2);
  const cats = await b.all<{ name: string }>("SELECT name FROM options WHERE kind='category' ORDER BY name");
  assert.equal(cats.filter((c) => c.name.toLowerCase() === 'groceries').length, 1);
  const rice = (await b.all<{ category_id: string }>("SELECT category_id FROM transactions WHERE name='Rice'"))[0];
  assert.equal(rice.category_id, 'existing-cat');
  assert.equal((await b.all<{ currency: string }>('SELECT currency FROM settings'))[0].currency, 'EUR');
  const r2 = await restoreData(b, data, 'merge');
  assert.equal(r2.transactionsAdded, 0);
  assert.equal(r2.transactionsSkipped, 2);
  assert.equal((await b.all('SELECT * FROM transactions')).length, 2);
});

test('merge handles an option id collision with a different option', async () => {
  const a = await seeded();
  const data = await collectData(a, { username: 'u' }, null);
  const b = await memoryDb(); await migrate(b);
  const first = data.options[0];
  await b.run('INSERT INTO options (id, kind, name) VALUES (?,?,?)', [first.id, first.kind === 'bank' ? 'category' : 'bank', 'Totally different']);
  await restoreData(b, data, 'merge');
  const names = (await b.all<{ name: string }>('SELECT name FROM options')).map((x) => x.name);
  assert.ok(names.includes('Totally different') && names.includes(first.name));
  const orphans = await b.all("SELECT id FROM transactions WHERE (category_id IS NOT NULL AND category_id NOT IN (SELECT id FROM options))");
  assert.equal(orphans.length, 0);
});

test('large account: 20k transactions round trip', async () => {
  const db = await memoryDb(); await migrate(db);
  await db.run("INSERT INTO options (id, kind, name) VALUES ('c1','category','Food')");
  await db.transaction(async () => {
    await db.runMany("INSERT INTO transactions (id, kind, name, amount_minor, occurred_on, category_id) VALUES (?,?,?,?,?,?)",
      Array.from({ length: 20000 }, (_, i) => [`id${i}`, 'expense', `Item ${i}`, 100 + i, '2026-03-01', 'c1']));
  });
  const file = await createBackup(await collectData(db, { username: 'big' }, null), 'correct horse', FAST);
  const { data } = await openBackup(file, 'correct horse');
  const dst = await memoryDb(); await migrate(dst);
  assert.equal((await restoreData(dst, data, 'replace')).transactionsAdded, 20000);
  assert.equal((await dst.all<{ n: number }>('SELECT count(*) n FROM transactions'))[0].n, 20000);
});

test('service-account key is restored into the account, and a restored online account resyncs once', async () => {
  const src = await seeded();
  await setSecret(src, GOOGLE_KEY, KEY);
  const file = await createBackup(await collectData(src, { username: 'u' }), 'correct horse', FAST);
  const { data } = await openBackup(file, 'correct horse');
  assert.equal(data.serviceAccountKey, KEY);
  const dst = await memoryDb(); await migrate(dst);
  await restoreData(dst, data, 'replace');
  assert.equal(await getSecret(dst, GOOGLE_KEY), KEY);
  assert.equal(await getSecret(dst, NEEDS_FULL_RESYNC), '1');
  // a backup without a key clears any key on the target after a replace
  const noKey = { ...data, serviceAccountKey: null };
  await restoreData(dst, noKey, 'replace');
  assert.equal(await getSecret(dst, GOOGLE_KEY), null);
});
