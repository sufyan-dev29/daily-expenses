import { test } from 'node:test';
import assert from 'node:assert/strict';
import { memoryDb } from './test-db.ts';
import { migrate, SCHEMA_VERSION } from './schema.ts';

const tx = (id: string, extra = '') =>
  `INSERT INTO transactions (id, kind, name, amount_minor, occurred_on) VALUES ('${id}','expense','x',100,'2026-05-05')${extra}`;
const outbox = (db: ReturnType<typeof memoryDb>) => db.all<{ transaction_id: string; op: string }>('SELECT transaction_id, op FROM sync_outbox ORDER BY id');
const goOnline = (db: ReturnType<typeof memoryDb>) =>
  db.run(`UPDATE settings SET mode = 'online', sheet = '{"spreadsheetId":"abc","tab":"Expenses"}' WHERE id = 1`);

test('migrate is idempotent and records the version', async () => {
  const db = memoryDb();
  assert.equal(await migrate(db), SCHEMA_VERSION);
  await migrate(db);
  const v = await db.all<{ user_version: number }>('PRAGMA user_version');
  assert.equal(v[0].user_version, SCHEMA_VERSION);
  const s = await db.all<{ n: number }>('SELECT count(*) AS n FROM settings');
  assert.equal(s[0].n, 1);
});

test('a database from a newer app version is refused', async () => {
  const db = memoryDb();
  await db.exec(`PRAGMA user_version = ${SCHEMA_VERSION + 5}`);
  await assert.rejects(() => migrate(db), /newer version/);
});

test('constraints reject bad rows', async () => {
  const db = memoryDb();
  await migrate(db);
  await assert.rejects(() => db.run(`INSERT INTO transactions (id, kind, name, amount_minor, occurred_on) VALUES ('a','expense','x',0,'2026-05-05')`));
  await assert.rejects(() => db.run(`INSERT INTO transactions (id, kind, name, amount_minor, occurred_on) VALUES ('a','expense','x',-5,'2026-05-05')`));
  await assert.rejects(() => db.run(`INSERT INTO transactions (id, kind, name, amount_minor, occurred_on) VALUES ('a','expense','   ',5,'2026-05-05')`));
  await assert.rejects(() => db.run(`INSERT INTO transactions (id, kind, name, amount_minor, occurred_on) VALUES ('a','gift','x',5,'2026-05-05')`));
  await assert.rejects(() => db.run(`INSERT INTO transactions (id, kind, name, amount_minor, occurred_on) VALUES ('a','expense','x',5,'05/05/2026')`));
  await assert.rejects(() => db.run(`INSERT INTO transactions (id, kind, name, amount_minor, occurred_on, category_id) VALUES ('a','expense','x',5,'2026-05-05','missing')`));
  await db.run(tx('ok'));
});

test('option names are unique per kind regardless of case', async () => {
  const db = memoryDb();
  await migrate(db);
  await db.run(`INSERT INTO options (id, kind, name) VALUES ('1','category','Groceries')`);
  await assert.rejects(() => db.run(`INSERT INTO options (id, kind, name) VALUES ('2','category','groceries')`));
  await db.run(`INSERT INTO options (id, kind, name) VALUES ('3','bank','Groceries')`); // different kind is fine
});

test('offline mode never queues sheet sync', async () => {
  const db = memoryDb();
  await migrate(db);
  await db.run(tx('a'));
  await db.run(`UPDATE transactions SET name = 'y' WHERE id = 'a'`);
  assert.deepEqual(await outbox(db), []);
});

test('online mode without a sheet configured queues nothing', async () => {
  const db = memoryDb();
  await migrate(db);
  await db.run(`UPDATE settings SET mode = 'online' WHERE id = 1`);
  await db.run(tx('a'));
  assert.deepEqual(await outbox(db), []);
});

test('online mode queues insert, edit, trash and purge as one row per transaction', async () => {
  const db = memoryDb();
  await migrate(db);
  await goOnline(db);
  await db.run(tx('a'));
  assert.deepEqual(await outbox(db), [{ transaction_id: 'a', op: 'upsert' }]);
  await db.run(`UPDATE transactions SET name = 'changed' WHERE id = 'a'`);
  await db.run(`UPDATE transactions SET deleted_at = '2026-06-01T00:00:00Z' WHERE id = 'a'`);
  assert.equal((await outbox(db)).length, 1, 'still a single pending row');
  await db.run(`DELETE FROM transactions WHERE id = 'a'`);
  assert.deepEqual(await outbox(db), [{ transaction_id: 'a', op: 'delete' }]);
});

test('bookkeeping-only updates do not requeue (no sync loop)', async () => {
  const db = memoryDb();
  await migrate(db);
  await goOnline(db);
  await db.run(tx('a'));
  await db.run('DELETE FROM sync_outbox');
  await db.run(`UPDATE transactions SET sheet_synced_at = '2026-06-01T00:00:00Z', updated_at = '2026-06-01T00:00:00Z' WHERE id = 'a'`);
  assert.deepEqual(await outbox(db), []);
});

test('a failed transaction rolls back completely', async () => {
  const db = memoryDb();
  await migrate(db);
  await assert.rejects(() =>
    db.transaction(async () => {
      await db.run(tx('a'));
      await db.run(tx('b'));
      throw new Error('boom');
    }),
  );
  const n = await db.all<{ n: number }>('SELECT count(*) AS n FROM transactions');
  assert.equal(n[0].n, 0);
});
