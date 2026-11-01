import { test } from 'node:test';
import assert from 'node:assert/strict';
import { memoryDb } from './test-db.ts';
import { migrate } from './schema.ts';
import { localClient } from './localclient.ts';

const TX = 'id,kind,name,amount,occurred_on,category_id,bank_id,payment_mode_id,income_source_id,need_want,notes,deleted_at,created_at';
async function setup() {
  const db = await memoryDb(); await migrate(db);
  const c = localClient(db);
  return { db, c };
}

test('options: insert returns id, unique name -> 23505 like Postgres, update/order work', async () => {
  const { c } = await setup();
  const a = await c.from('options').insert({ kind: 'category', name: 'Food', sort_order: 0, icon: 'restaurant', color: null }).select('id').single();
  assert.ok(a.data?.id && !a.error);
  const dup = await c.from('options').insert({ kind: 'category', name: 'FOOD', sort_order: 1 });
  assert.equal(dup.error?.code, '23505');
  await c.from('options').insert({ kind: 'category', name: 'Bills', sort_order: 1 });
  await c.from('options').update({ sort_order: 5 }).eq('id', a.data.id);
  const all = await c.from('options').select('*').order('sort_order').order('created_at');
  assert.deepEqual(all.data!.map((o: any) => o.name), ['Bills', 'Food']);
  await c.from('options').update({ archived_at: '2026-01-01T00:00:00Z' }).eq('id', a.data.id);
  assert.equal((await c.from('options').select('*').eq('id', a.data.id).single()).data!.archived_at, '2026-01-01T00:00:00Z');
});

test('transactions: amount is in major units both ways, upsert is idempotent, soft delete/restore, hard delete', async () => {
  const { c } = await setup();
  const row = { id: 'tx-1', kind: 'expense', name: 'Lunch', amount: 1234.56, occurred_on: '2026-03-04', category_id: null, bank_id: null, payment_mode_id: null, income_source_id: null, need_want: 'need', notes: null };
  assert.equal((await c.from('transactions').upsert(row, { onConflict: 'id' })).error, null);
  assert.equal((await c.from('transactions').upsert({ ...row, amount: 99.5, name: 'Lunch 2' }, { onConflict: 'id' })).error, null);
  let r = await c.from('transactions').select(TX).eq('kind', 'expense').is('deleted_at', null).order('occurred_on', { ascending: false });
  assert.equal(r.data!.length, 1);
  assert.equal((r.data![0] as any).amount, 99.5);
  assert.equal((r.data![0] as any).name, 'Lunch 2');
  await c.from('transactions').update({ deleted_at: new Date().toISOString() }).eq('id', 'tx-1');
  assert.equal((await c.from('transactions').select(TX).is('deleted_at', null)).data!.length, 0);
  assert.equal((await c.from('transactions').select(TX).not('deleted_at', 'is', null).order('deleted_at', { ascending: false }).limit(500)).data!.length, 1);
  await c.from('transactions').update({ deleted_at: null }).eq('id', 'tx-1');
  assert.equal((await c.from('transactions').select(TX).is('deleted_at', null)).data!.length, 1);
  await c.from('transactions').delete().eq('id', 'tx-1');
  assert.equal((await c.from('transactions').select(TX)).data!.length, 0);
});

test('transactions: validation errors come back as { error } instead of throwing', async () => {
  const { c } = await setup();
  const bad = await c.from('transactions').upsert({ id: 'x', kind: 'expense', name: 'Zero', amount: 0, occurred_on: '2026-01-01' }, { onConflict: 'id' });
  assert.ok(bad.error);
  const baddate = await c.from('transactions').upsert({ id: 'y', kind: 'expense', name: 'D', amount: 5, occurred_on: 'tomorrow' }, { onConflict: 'id' });
  assert.ok(baddate.error);
  const nan = await c.from('transactions').upsert({ id: 'z', kind: 'expense', name: 'N', amount: NaN, occurred_on: '2026-01-01' }, { onConflict: 'id' });
  assert.ok(nan.error);
});

test('list screen query: filter, search (ilike), order, range paging, count', async () => {
  const { c } = await setup();
  for (let i = 1; i <= 25; i++) await c.from('transactions').upsert({ id: `t${i}`, kind: i % 5 === 0 ? 'income' : 'expense', name: i % 2 ? `Coffee ${i}` : `Bus ${i}`, amount: i * 10, occurred_on: `2026-02-${String((i % 28) + 1).padStart(2, '0')}` }, { onConflict: 'id' });
  const page1 = await c.from('transactions').select(TX, { count: 'exact' }).is('deleted_at', null).gte('occurred_on', '2026-02-01').lte('occurred_on', '2026-02-28').eq('kind', 'expense').ilike('name', '%coffee%').order('amount', { ascending: false }).order('created_at', { ascending: false }).range(0, 4);
  assert.equal(page1.count, 10);
  assert.equal(page1.data!.length, 5);
  assert.equal((page1.data![0] as any).amount, 230);
  const page2 = await c.from('transactions').select(TX, { count: 'exact' }).eq('kind', 'expense').ilike('name', '%coffee%').order('amount', { ascending: false }).range(5, 9);
  assert.equal(page2.data!.length, 5);
  const amt = await c.from('transactions').select(TX).gte('amount', 100).lte('amount', 120);
  assert.deepEqual(amt.data!.map((r: any) => r.amount).sort((a: number, b: number) => a - b), [100, 110, 120]);
  const last = await c.from('transactions').select(TX).eq('kind', 'expense').is('deleted_at', null).order('created_at', { ascending: false }).limit(1).maybeSingle();
  assert.ok(last.data && !last.error);
  const none = await c.from('transactions').select(TX).eq('kind', 'income').eq('name', 'nope').limit(1).maybeSingle();
  assert.equal(none.data, null); assert.equal(none.error, null);
});

test('search text is bound, never concatenated (SQL injection attempts are inert)', async () => {
  const { c, db } = await setup();
  await c.from('transactions').upsert({ id: 'a', kind: 'expense', name: "Bob's lunch", amount: 5, occurred_on: '2026-01-01' }, { onConflict: 'id' });
  const evil = await c.from('transactions').select(TX).ilike('name', "%'; DROP TABLE transactions; --%");
  assert.equal(evil.error, null); assert.equal(evil.data!.length, 0);
  const apos = await c.from('transactions').select(TX).ilike('name', "%bob's%");
  assert.equal(apos.data!.length, 1);
  assert.equal((await db.all('SELECT count(*) n FROM transactions'))[0].n, 1);
  const badcol = await c.from('transactions').select(TX).eq('name; DROP TABLE transactions', 'x');
  assert.ok(badcol.error);
  assert.throws(() => c.from('sqlite_master'), /Unknown table/);
  const nodelete = await c.from('transactions').delete();
  assert.ok(nodelete.error, 'delete without filter must be refused');
  assert.equal((await db.all('SELECT count(*) n FROM transactions'))[0].n, 1);
});

test('templates: payload round-trips as an object; settings read/patch parse JSON fields', async () => {
  const { c } = await setup();
  const ins = await c.from('templates').insert({ kind: 'expense', name: 'Tea', behavior: 'fill', payload: { name: 'Tea', amount: 50, category_id: null }, sort_order: 0 });
  assert.equal(ins.error, null);
  const t = await c.from('templates').select('*').order('sort_order').order('created_at');
  assert.deepEqual((t.data![0] as any).payload, { name: 'Tea', amount: 50, category_id: null });
  await c.from('templates').update({ behavior: 'instant' }).eq('id', (t.data![0] as any).id);
  assert.equal((await c.from('templates').select('*').single()).data!.behavior, 'instant');

  const s = (await c.from('user_settings').select('*').maybeSingle()).data as any;
  assert.equal(s.currency, 'PKR'); assert.equal(s.remember_last.category, true); assert.equal(s.sheet, null);
  const up = await c.from('user_settings').update({ currency: 'USD', accent_hex: '#112233:vibrant', sheet: { spreadsheetId: 's1', tab: 'T' } });
  assert.equal(up.error, null);
  const s2 = (await c.from('user_settings').select('*').maybeSingle()).data as any;
  assert.equal(s2.currency, 'USD'); assert.deepEqual(s2.sheet, { spreadsheetId: 's1', tab: 'T' });
});

test('online mode: saving through the client queues exactly one outbox row (offline queue for the Sheet)', async () => {
  const { c, db } = await setup();
  await c.from('user_settings').update({ mode: 'online', sheet: { spreadsheetId: 'abc', tab: 'Expenses' } });
  const row = { id: 'q1', kind: 'expense', name: 'A', amount: 10, occurred_on: '2026-04-01' };
  await c.from('transactions').upsert(row, { onConflict: 'id' });
  await c.from('transactions').upsert({ ...row, amount: 11 }, { onConflict: 'id' });
  await c.from('transactions').update({ deleted_at: new Date().toISOString() }).eq('id', 'q1');
  const ob = await db.all<{ transaction_id: string; op: string }>('SELECT transaction_id, op FROM sync_outbox');
  assert.deepEqual(ob, [{ transaction_id: 'q1', op: 'upsert' }]);
  await c.from('transactions').delete().eq('id', 'q1');
  assert.deepEqual(await db.all('SELECT op FROM sync_outbox'), [{ op: 'delete' }]);
});

test('rpc insights returns the shape the Insights screen reads', async () => {
  const { c } = await setup();
  await c.from('transactions').upsert({ id: 'i1', kind: 'expense', name: 'X', amount: 100, occurred_on: '2026-05-05' }, { onConflict: 'id' });
  await c.from('transactions').upsert({ id: 'i2', kind: 'income', name: 'Y', amount: 400, occurred_on: '2026-05-06' }, { onConflict: 'id' });
  const r = await c.rpc('insights', { p_from: '2026-05-01', p_to: '2026-05-31', p_gran: 'week', p_kind: null, p_category: null, p_bank: null, p_mode: null, p_need_want: null, p_source: null, p_min: null, p_max: null, p_q: null, p_week_start: 1 });
  assert.equal(r.error, null);
  assert.equal((r.data as any).totals.spent, 100);
  assert.equal((r.data as any).totals.income, 400);
  const bad = await c.rpc('insights', { p_from: 'nope', p_to: '2026-05-31', p_gran: 'week', p_week_start: 1 });
  assert.ok(bad.error);
  assert.ok((await c.rpc('drop_everything', {})).error);
});
