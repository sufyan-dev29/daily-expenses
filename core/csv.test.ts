import { test } from 'node:test';
import assert from 'node:assert/strict';
import { memoryDb } from './test-db.ts';
import { migrate } from './schema.ts';
import { applyImport, csvField, CsvError, detectColumns, exportCsv, parseCsv, parseDate, planImport } from './csv.ts';
import { parseAmount, parseAmountSigned } from './money.ts';

const fresh = async () => { const db = memoryDb(); await migrate(db); return db; };
const count = async (db: ReturnType<typeof memoryDb>, table: string) => (await db.all<{ n: number }>(`SELECT count(*) AS n FROM ${table}`))[0].n;

test('parser: quotes, embedded commas and newlines, CRLF, BOM, blank lines', () => {
  const { rows } = parseCsv('﻿a,b,c\r\n"x, y","He said ""hi""","line1\nline2"\r\n\r\n1,2,3\r\n');
  assert.deepEqual(rows, [['a', 'b', 'c'], ['x, y', 'He said "hi"', 'line1\nline2'], ['1', '2', '3']]);
});

test('parser: delimiter detection (semicolon, tab) and an unterminated quote is an error', () => {
  assert.deepEqual(parseCsv('a;b;c\n1;2;3').rows, [['a', 'b', 'c'], ['1', '2', '3']]);
  assert.deepEqual(parseCsv('a\tb\n1\t2').rows, [['a', 'b'], ['1', '2']]);
  assert.throws(() => parseCsv('a,b\n"oops,1'), CsvError);
});

test('parser: size and row limits', () => {
  assert.throws(() => parseCsv('a'.repeat(5_000_001)), /too large/);
  assert.throws(() => parseCsv(Array.from({ length: 50_005 }, () => 'a').join('\n')), /Too many rows/);
});

test('formula injection: written with a leading quote, and read back without it', () => {
  assert.equal(csvField('=HYPERLINK("x")'), `"'=HYPERLINK(""x"")"`);
  assert.equal(csvField('+1'), "'+1");
  assert.equal(csvField('@SUM(A1)'), "'@SUM(A1)");
  assert.equal(csvField('plain'), 'plain');
});

test('dates: ISO, old-sheet format, month names, day-first vs month-first, Excel serial, invalid', () => {
  assert.equal(parseDate('2026-09-10'), '2026-09-10');
  assert.equal(parseDate('Thu, 10 Sep 2026'), '2026-09-10');
  assert.equal(parseDate('10 September 2026'), '2026-09-10');
  assert.equal(parseDate('Sep 10, 2026'), '2026-09-10');
  assert.equal(parseDate('10-Sep-26'), '2026-09-10');
  assert.equal(parseDate('Sat 5 Sep 2026'), '2026-09-05');
  assert.equal(parseDate('Monday, September 7, 2026'), null, 'unsupported long form is rejected, not guessed');
  assert.equal(parseDate('05/06/2026', 'dmy'), '2026-06-05');
  assert.equal(parseDate('05/06/2026', 'mdy'), '2026-05-06');
  assert.equal(parseDate('46275'), '2026-09-10');
  assert.equal(parseDate('2026-02-31'), null);
  assert.equal(parseDate('31/04/2026'), null);
  assert.equal(parseDate('not a date'), null);
  assert.equal(parseDate(''), null);
});

test('amounts: separators, currency text, accounting negatives', () => {
  assert.equal(parseAmount('1,234.50'), 1234.5);
  assert.equal(parseAmount('Rs 1 200'), 1200);
  assert.equal(parseAmount('PKR 5,000'), 5000);
  assert.equal(parseAmount('1.234,50'), 1234.5);
  assert.equal(parseAmount('12,5'), 12.5);
  assert.equal(parseAmount('1,234'), 1234);
  assert.equal(parseAmount('1,234,567'), 1234567);
  assert.equal(parseAmount('0'), null);
  assert.equal(parseAmount('abc'), null);
  assert.equal(parseAmount('-5'), null);
  assert.equal(parseAmountSigned('(250)'), -250);
  assert.equal(parseAmountSigned('-250.5'), -250.5);
});

test('header detection: export format, bank-style Type column, headerless old sheet', () => {
  const a = detectColumns([['Date', 'Description', 'Category', 'Amount', 'Payment Mode', 'Bank Name', 'Type', 'Notes', 'Entry', 'ID']]);
  assert.equal(a.hasHeader, true);
  assert.equal(a.map.type, 6);
  assert.equal(a.map.entry, 8);
  const b = detectColumns([['Date', 'Details', 'Amount', 'Type'], ['2026-01-01', 'x', '5', 'Debit'], ['2026-01-02', 'y', '6', 'Credit']]);
  assert.equal(b.map.entry, 3);
  assert.equal(b.map.type, null);
  const c = detectColumns([['Thu, 10 Sep 2026', 'Rent', 'Housing', '50000', 'Bank Transfer', 'MCB', 'Need', '']]);
  assert.equal(c.hasHeader, false);
  assert.equal(c.map.amount, 3);
  assert.equal(c.map.notes, 7);
});

test('import: matches existing lists case-insensitively and creates the rest', async () => {
  const db = await fresh();
  await db.run(`INSERT INTO options (id, kind, name) VALUES ('c1','category','Groceries'), ('b1','bank','MCB Bank'), ('s1','income_source','Salary')`);
  const csv = [
    'Date,Description,Category,Amount,Payment Mode,Bank Name,Type,Notes',
    '2026-09-01,Milk,groceries,120.50,Cash,mcb bank,Need,fresh',
    '2026-09-02,Gym,  Fitness ,3000,Card,JS Bank,Want,',
    '2026-09-03,Eggs,GROCERIES,300,Cash,MCB Bank,,',
  ].join('\n');
  const plan = await planImport(db, csv, { kind: 'expense' });
  assert.equal(plan.rows.length, 3);
  assert.deepEqual(plan.newOptions.map((o) => `${o.kind}:${o.name}:${o.count}`).sort(), ['bank:JS Bank:1', 'category:Fitness:1', 'payment_mode:Card:1', 'payment_mode:Cash:2']);
  assert.deepEqual(plan.matchedOptions.map((o) => `${o.kind}:${o.name}:${o.count}`).sort(), ['bank:MCB Bank:2', 'category:Groceries:2']);
  const before = await count(db, 'transactions');
  assert.equal(before, 0, 'planning writes nothing');
  const res = await applyImport(db, plan);
  assert.equal(res.inserted, 3);
  assert.equal(res.createdOptions, 4);
  const cats = await db.all<{ name: string }>(`SELECT name FROM options WHERE kind='category' ORDER BY name`);
  assert.deepEqual(cats.map((c) => c.name), ['Fitness', 'Groceries']);
  const milk = (await db.all<{ category_id: string; bank_id: string; amount_minor: number; need_want: string }>(`SELECT category_id, bank_id, amount_minor, need_want FROM transactions WHERE name='Milk'`))[0];
  assert.deepEqual(milk, { category_id: 'c1', bank_id: 'b1', amount_minor: 12050, need_want: 'need' });
});

test('import as income maps the Category column to income sources', async () => {
  const db = await fresh();
  const plan = await planImport(db, 'Date,Description,Category,Amount\n2026-01-31,January pay,Salary,100000', { kind: 'income' });
  await applyImport(db, plan);
  const r = (await db.all<{ kind: string; src: string; cat: string | null }>(
    `SELECT t.kind, s.name AS src, t.category_id AS cat FROM transactions t LEFT JOIN options s ON s.id = t.income_source_id`))[0];
  assert.deepEqual(r, { kind: 'income', src: 'Salary', cat: null });
  assert.equal((await db.all<{ kind: string }>(`SELECT kind FROM options`))[0].kind, 'income_source');
});

test('auto kind reads the Entry column; unknown values are reported, not guessed', async () => {
  const db = await fresh();
  const csv = 'Date,Description,Amount,Entry\n2026-01-01,Pay,500,Income\n2026-01-02,Food,50,Expense\n2026-01-03,Odd,5,Transfer';
  const plan = await planImport(db, csv, { kind: 'auto' });
  assert.deepEqual(plan.rows.map((r) => r.kind), ['income', 'expense']);
  assert.equal(plan.errorCount, 1);
  assert.match(plan.errors[0].reason, /Unknown entry type/);
});

test('old sheet format: weekday dates, headerless, Need/Want', async () => {
  const db = await fresh();
  const csv = '"Thu, 10 Sep 2026",Rent,Housing,"50,000",Bank Transfer,MCB Bank,Need,Sept rent\n"Fri, 11 Sep 2026",Snacks,Personal Expense,250,Cash,,Want,';
  const plan = await planImport(db, csv, { kind: 'expense' });
  assert.equal(plan.detected.hasHeader, false);
  assert.equal(plan.rows.length, 2);
  assert.equal(plan.rows[0].on, '2026-09-10');
  assert.equal(plan.rows[0].minor, 5000000);
});

test('semicolon file with decimal commas and day-first dates', async () => {
  const db = await fresh();
  const csv = 'Datum;Name;Betrag\n25/12/2026;Gift;12,50\n01/02/2026;Book;1.234,00';
  const plan = await planImport(db, csv.replace('Datum', 'Date').replace('Name', 'Description').replace('Betrag', 'Amount'), { kind: 'expense' });
  assert.equal(plan.detected.dateOrder, 'dmy');
  assert.deepEqual(plan.rows.map((r) => [r.on, r.minor]), [['2026-12-25', 1250], ['2026-02-01', 123400]]);
});

test('bad rows are reported with line numbers and the rest still import', async () => {
  const db = await fresh();
  const csv = ['Date,Description,Amount', '2026-01-01,ok,10', 'nope,bad date,10', '2026-01-03,bad amount,abc', '2026-01-04,,10', '2026-01-05,fine,(7.5)', ',,', '2026-01-06,zero,0'].join('\n');
  const plan = await planImport(db, csv, { kind: 'expense' });
  assert.equal(plan.rows.length, 2);
  assert.equal(plan.errorCount, 4);
  assert.deepEqual(plan.errors.map((e) => e.line), [3, 4, 5, 8]);
  assert.ok(plan.warnings.some((w) => /negative/.test(w)));
  const res = await applyImport(db, plan);
  assert.equal(res.inserted, 2);
});

test('duplicates are skipped once each, so two identical rows survive a re-import', async () => {
  const db = await fresh();
  const csv = 'Date,Description,Amount\n2026-03-03,Coffee,200\n2026-03-03,Coffee,200\n2026-03-04,Tea,100';
  await applyImport(db, await planImport(db, csv, { kind: 'expense' }));
  assert.equal(await count(db, 'transactions'), 3);
  const again = await planImport(db, csv, { kind: 'expense' });
  assert.equal(again.duplicates, 3);
  assert.equal(again.rows.length, 0);
  const more = await planImport(db, csv + '\n2026-03-03,Coffee,200', { kind: 'expense' });
  assert.equal(more.rows.length, 1, 'only the third identical coffee is new');
  const off = await planImport(db, csv, { kind: 'expense', skipDuplicates: false });
  assert.equal(off.rows.length, 3);
});

test('export then import reproduces everything, including awkward text', async () => {
  const a = await fresh();
  await a.run(`INSERT INTO options (id, kind, name) VALUES ('c1','category','Food, "fancy"'), ('b1','bank','MCB'), ('m1','payment_mode','Cash'), ('s1','income_source','Salary')`);
  const tx = [
    ['11111111-1111-4111-8111-111111111111', 'expense', 'Dinner, with "friends"', 123456, '2026-05-05', 'c1', 'b1', 'm1', null, 'want', 'line1\nline2'],
    ['22222222-2222-4222-8222-222222222222', 'expense', '=cmd|\' /C calc\'!A0', 5000, '2026-05-06', null, null, null, null, null, '-starts with dash'],
    ['33333333-3333-4333-8333-333333333333', 'income', 'Pay ✓ ünïcode', 9999999, '2026-05-07', null, 'b1', null, 's1', null, null],
  ];
  for (const t of tx) await a.run(`INSERT INTO transactions (id, kind, name, amount_minor, occurred_on, category_id, bank_id, payment_mode_id, income_source_id, need_want, notes) VALUES (?,?,?,?,?,?,?,?,?,?,?)`, t as never);
  await a.run(`INSERT INTO transactions (id, kind, name, amount_minor, occurred_on, deleted_at) VALUES ('trashed','expense','gone',1,'2026-05-08','2026-05-09T00:00:00Z')`);
  const csv = await exportCsv(a);
  assert.ok(!csv.includes('gone'), 'trashed entries are not exported');
  assert.ok(csv.includes(`'=cmd`), 'formula is neutralised in the file');

  const b = await fresh();
  const plan = await planImport(b, csv, { kind: 'auto' });
  assert.equal(plan.errorCount, 0);
  await applyImport(b, plan);
  const dump = (db: ReturnType<typeof memoryDb>) => db.all(
    `SELECT t.id, t.kind, t.name, t.amount_minor, t.occurred_on, c.name AS category, bk.name AS bank, m.name AS mode, s.name AS source, t.need_want, t.notes
       FROM transactions t LEFT JOIN options c ON c.id=t.category_id LEFT JOIN options bk ON bk.id=t.bank_id
       LEFT JOIN options m ON m.id=t.payment_mode_id LEFT JOIN options s ON s.id=t.income_source_id
      WHERE t.deleted_at IS NULL ORDER BY t.id`);
  assert.deepEqual(await dump(b), await dump(a));
});

test('import is atomic: a failure part-way leaves nothing behind', async () => {
  const db = await fresh();
  const plan = await planImport(db, 'Date,Description,Category,Amount\n2026-01-01,a,New cat,10\n2026-01-02,b,New cat,10', { kind: 'expense' });
  plan.rows[1].minor = -1; // violates the CHECK constraint on the second insert
  await assert.rejects(() => applyImport(db, plan));
  assert.equal(await count(db, 'transactions'), 0);
  assert.equal(await count(db, 'options'), 0);
});

test('archived lists used by an import come back', async () => {
  const db = await fresh();
  await db.run(`INSERT INTO options (id, kind, name, archived_at) VALUES ('c1','category','Old','2026-01-01T00:00:00Z')`);
  const plan = await planImport(db, 'Date,Description,Category,Amount\n2026-01-01,a,old,10', { kind: 'expense' });
  assert.equal(plan.reactivated, 1);
  const res = await applyImport(db, plan);
  assert.equal(res.reactivated, 1);
  assert.equal((await db.all<{ archived_at: string | null }>(`SELECT archived_at FROM options WHERE id='c1'`))[0].archived_at, null);
});

test('hostile text is stored as plain text; SQL fragments do nothing', async () => {
  const db = await fresh();
  const evil = `x'); DROP TABLE transactions;--`;
  const plan = await planImport(db, `Date,Description,Category,Amount\n2026-01-01,"${evil}","${evil}",10`, { kind: 'expense' });
  await applyImport(db, plan);
  assert.equal(await count(db, 'transactions'), 1);
  assert.equal((await db.all<{ name: string }>('SELECT name FROM transactions'))[0].name, evil);
});

test('missing required columns gives a clear error', async () => {
  const db = await fresh();
  await assert.rejects(() => planImport(db, 'Foo,Bar\n1,2', { kind: 'expense' }), /Date column and an Amount column|empty/);
  await assert.rejects(() => planImport(db, '', { kind: 'expense' }), /empty/);
});

test('a large import (20,000 rows) works and is fast enough', async () => {
  const db = await fresh();
  const lines = ['Date,Description,Category,Amount'];
  for (let i = 0; i < 20000; i++) lines.push(`2026-0${1 + (i % 9)}-${String(1 + (i % 28)).padStart(2, '0')},Item ${i},Cat ${i % 7},${(i % 900) + 1}.25`);
  const t0 = Date.now();
  const plan = await planImport(db, lines.join('\n'), { kind: 'expense' });
  const res = await applyImport(db, plan);
  assert.equal(res.inserted, 20000);
  assert.equal(res.createdOptions, 7);
  assert.ok(Date.now() - t0 < 15000, `took ${Date.now() - t0} ms`);
});
