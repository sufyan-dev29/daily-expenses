import { test } from 'node:test';
import assert from 'node:assert/strict';
import { memoryDb } from './test-db.ts';
import { AuthError, AuthService, MAX_LOCK_MS, generateRecoveryCode, migrateAccounts, normalizeRecoveryCode } from './auth.ts';

async function setup() {
  const db = await memoryDb(); await migrateAccounts(db);
  let t = 1_000_000;
  const clock = { now: () => t, advance: (ms: number) => { t += ms; } };
  const auth = new AuthService(db, { now: clock.now, pwIterations: 1000, tokenIterations: 1000 });
  return { db, auth, clock };
}
const PW = 'correct horse battery';

test('create account, log in; passwords are never stored in the clear', async () => {
  const { db, auth } = await setup();
  const { account, recoveryCode } = await auth.createAccount('Sufyan', PW);
  assert.equal(account.username, 'sufyan');
  assert.match(recoveryCode, /^[0-9A-HJKMNP-TV-Z]{5}(-[0-9A-HJKMNP-TV-Z]{5}){3}$/);
  const ok = await auth.login('SUFYAN', PW);
  assert.ok(ok.ok && ok.account.id === account.id);
  const raw = JSON.stringify(await db.all('SELECT * FROM accounts'));
  assert.ok(!raw.includes(PW) && !raw.includes(recoveryCode) && !raw.includes(normalizeRecoveryCode(recoveryCode)));
  const bad = await auth.login('sufyan', PW + 'x');
  assert.deepEqual([bad.ok, (bad as any).reason, (bad as any).attemptsLeft], [false, 'invalid', 4]);
  assert.deepEqual(await auth.login('nobody', PW), { ok: false, reason: 'invalid' });
});

test('validation: usernames, password length, duplicates (case-insensitive)', async () => {
  const { auth } = await setup();
  await assert.rejects(() => auth.createAccount('ab', PW), (e: any) => e.code === 'username');
  await assert.rejects(() => auth.createAccount('bad name!', PW), (e: any) => e.code === 'username');
  await assert.rejects(() => auth.createAccount('okname', 'short'), (e: any) => e.code === 'password');
  await assert.rejects(() => auth.createAccount('okname', 'x'.repeat(201)), (e: any) => e.code === 'password');
  await auth.createAccount('okname', PW);
  await assert.rejects(() => auth.createAccount('OkName', PW), (e: any) => e.code === 'taken');
});

test('lockout: 5 wrong tries lock, grows, survives a restart, clears on success, capped at 15 minutes', async () => {
  const { db, auth, clock } = await setup();
  await auth.createAccount('user1', PW);
  for (let i = 0; i < 4; i++) assert.equal((await auth.login('user1', 'nope')).ok, false);
  const fifth = await auth.login('user1', 'nope') as any;
  assert.equal(fifth.reason, 'locked'); assert.equal(fifth.retryInMs, 30_000);
  const during = await auth.login('user1', PW) as any; // even the right password is refused while locked
  assert.equal(during.reason, 'locked');
  const restarted = new AuthService(db, { now: clock.now, pwIterations: 1000, tokenIterations: 1000 });
  assert.equal(((await restarted.login('user1', PW)) as any).reason, 'locked');
  clock.advance(30_001);
  const sixth = await auth.login('user1', 'nope') as any;
  assert.equal(sixth.retryInMs, 60_000);
  clock.advance(60_001);
  assert.equal((await auth.login('user1', PW)).ok, true);
  assert.equal((await auth.login('user1', 'nope') as any).attemptsLeft, 4, 'counter reset after success');
  for (let i = 0; i < 20; i++) { clock.advance(MAX_LOCK_MS + 1); await auth.login('user1', 'nope'); }
  const capped = await auth.login('user1', 'nope') as any;
  assert.ok(capped.retryInMs <= MAX_LOCK_MS);
});

test('change password needs the old one, applies the same lockout, and invalidates the old password', async () => {
  const { auth } = await setup();
  const { account } = await auth.createAccount('user2', PW);
  await assert.rejects(() => auth.changePassword(account.id, 'wrong password!', 'new password 123'), (e: any) => e.code === 'invalid');
  await assert.rejects(() => auth.changePassword(account.id, PW, 'short'), (e: any) => e.code === 'password');
  await auth.changePassword(account.id, PW, 'new password 123');
  assert.equal((await auth.login('user2', PW)).ok, false);
  assert.equal((await auth.login('user2', 'new password 123')).ok, true);
  for (let i = 0; i < 5; i++) await auth.confirmPassword(account.id, 'bad').catch(() => {});
  await assert.rejects(() => auth.confirmPassword(account.id, 'new password 123'), (e: any) => e.code === 'locked');
});

test('recovery code resets the password once, issues a new code and drops biometrics', async () => {
  const { auth } = await setup();
  const { account, recoveryCode } = await auth.createAccount('user3', PW);
  await auth.setBiometricToken(account.id, 'tok-123');
  assert.equal((await auth.listAccounts())[0].biometric, true);
  await assert.rejects(() => auth.resetWithRecovery('user3', '00000-00000-00000-00000', 'brand new pass 1'), (e: any) => e.code === 'invalid');
  const lower = recoveryCode.toLowerCase().replace(/-/g, ' ');
  const r = await auth.resetWithRecovery('user3', lower, 'brand new pass 1');
  assert.notEqual(r.recoveryCode, recoveryCode);
  assert.equal((await auth.login('user3', PW)).ok, false);
  assert.equal((await auth.login('user3', 'brand new pass 1')).ok, true);
  await assert.rejects(() => auth.resetWithRecovery('user3', recoveryCode, 'another pass 12345'), (e: any) => e.code === 'invalid', 'old code is dead');
  assert.equal((await auth.listAccounts())[0].biometric, false);
  assert.equal((await auth.loginWithBiometricToken(account.id, 'tok-123')).ok, false);
  const again = await auth.resetWithRecovery('user3', r.recoveryCode, 'third password 12');
  assert.ok(again.recoveryCode);
});

test('recovery guessing is rate limited too', async () => {
  const { auth } = await setup();
  await auth.createAccount('user4', PW);
  for (let i = 0; i < 4; i++) await assert.rejects(() => auth.resetWithRecovery('user4', 'AAAAA-AAAAA-AAAAA-AAAAA', 'whatever pass 12'), (e: any) => e.code === 'invalid');
  await assert.rejects(() => auth.resetWithRecovery('user4', 'AAAAA-AAAAA-AAAAA-AAAAA', 'whatever pass 12'), (e: any) => e.code === 'locked');
});

test('biometric token: enrol, log in, disable; wrong token counts as a failed attempt', async () => {
  const { auth } = await setup();
  const { account } = await auth.createAccount('user5', PW);
  assert.equal((await auth.loginWithBiometricToken(account.id, 'x')).ok, false, 'not enrolled');
  await auth.setBiometricToken(account.id, 'secret-token');
  assert.equal((await auth.loginWithBiometricToken(account.id, 'secret-token')).ok, true);
  const bad = await auth.loginWithBiometricToken(account.id, 'wrong') as any;
  assert.equal(bad.ok, false); assert.equal(bad.attemptsLeft, 4);
  await auth.setBiometricToken(account.id, null);
  assert.equal((await auth.loginWithBiometricToken(account.id, 'secret-token')).ok, false);
});

test('regenerate recovery code (password required) replaces the old one; delete account needs the password', async () => {
  const { auth } = await setup();
  const { account, recoveryCode } = await auth.createAccount('user6', PW);
  await assert.rejects(() => auth.regenerateRecoveryCode(account.id, 'nope nope nope'), (e: any) => e.code === 'invalid');
  const fresh = await auth.regenerateRecoveryCode(account.id, PW);
  assert.notEqual(fresh, recoveryCode);
  await assert.rejects(() => auth.resetWithRecovery('user6', recoveryCode, 'zzzz password 123'), AuthError);
  await assert.rejects(() => auth.deleteAccount(account.id, 'nope nope nope'));
  assert.equal((await auth.deleteAccount(account.id, PW)).username, 'user6');
  assert.equal(await auth.count(), 0);
});

test('recovery codes are random and well-formed; normalisation forgives look-alike characters', () => {
  const seen = new Set(Array.from({ length: 200 }, generateRecoveryCode));
  assert.equal(seen.size, 200);
  assert.equal(normalizeRecoveryCode('abcde-0o1il-fghjk-mnpqr'), 'ABCDE00111FGHJKMNPQR');
});

test('SQL metacharacters in the username are inert', async () => {
  const { auth } = await setup();
  await auth.createAccount('victim', PW);
  assert.equal((await auth.login("victim' OR '1'='1", PW)).ok, false);
  await assert.rejects(() => auth.createAccount("a'; DROP TABLE accounts;--", PW), (e: any) => e.code === 'username');
  assert.equal(await auth.count(), 1);
});
