/**
 * Local accounts. Everything lives on the device; there is no server and no email.
 * - Passwords and the recovery code are stored only as salted PBKDF2-SHA256 hashes (iterations stored per account).
 * - Wrong attempts lock the account for a growing time (persisted, so restarting the app does not reset it).
 * - A biometric token (random, held in the Android Keystore behind the fingerprint/face prompt) is checked the same way.
 * - The database encryption key is NOT derived from the password: it is a random key kept by the Android Keystore.
 */
import type { SqlDb } from './db.ts';
import { one } from './db.ts';
import { applyMigrations } from './schema.ts';
import { fromBase64, randomBytes, timingSafeEqual, toBase64, utf8 } from './bytes.ts';
import { uuid } from './uuid.ts';

const ACCOUNT_MIGRATIONS: string[] = [
  `
  CREATE TABLE accounts (
    id TEXT PRIMARY KEY,
    username TEXT NOT NULL UNIQUE COLLATE NOCASE,
    db_name TEXT NOT NULL UNIQUE,
    pw_salt TEXT NOT NULL, pw_hash TEXT NOT NULL, pw_iter INTEGER NOT NULL,
    rec_salt TEXT NOT NULL, rec_hash TEXT NOT NULL, rec_iter INTEGER NOT NULL,
    bio_salt TEXT, bio_hash TEXT, bio_iter INTEGER,
    failed_count INTEGER NOT NULL DEFAULT 0,
    locked_until INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    last_login_at TEXT
  );
--#
  `,
];

export async function migrateAccounts(db: SqlDb) { return applyMigrations(db, ACCOUNT_MIGRATIONS); }

export const PASSWORD_MIN = 10;
export const PASSWORD_MAX = 200;
export const PW_ITERATIONS = 600_000;
export const TOKEN_ITERATIONS = 100_000;
export const MAX_FREE_ATTEMPTS = 5;
export const MAX_LOCK_MS = 15 * 60_000;

export interface Account { id: string; username: string; dbName: string; biometric: boolean }
export type LoginResult =
  | { ok: true; account: Account }
  | { ok: false; reason: 'invalid' | 'locked'; retryInMs?: number; attemptsLeft?: number };

export class AuthError extends Error {
  code: 'username' | 'password' | 'taken' | 'invalid' | 'locked' | 'missing';
  retryInMs?: number;
  constructor(message: string, code: AuthError['code'], retryInMs?: number) { super(message); this.code = code; this.retryInMs = retryInMs; }
}

interface Row {
  id: string; username: string; db_name: string; pw_salt: string; pw_hash: string; pw_iter: number;
  rec_salt: string; rec_hash: string; rec_iter: number; bio_salt: string | null; bio_hash: string | null; bio_iter: number | null;
  failed_count: number; locked_until: number;
}

async function pbkdf2(secret: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', utf8(secret) as BufferSource, 'PBKDF2', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: salt as BufferSource, iterations }, key, 256));
}

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
export function generateRecoveryCode(): string {
  const b = randomBytes(20);
  const chars = Array.from(b, (x) => CROCKFORD[x & 31]); // 256 % 32 === 0, so no bias
  return [0, 5, 10, 15].map((i) => chars.slice(i, i + 5).join('')).join('-');
}
export function normalizeRecoveryCode(input: string): string {
  return input.toUpperCase().replace(/[\s-]/g, '').replace(/O/g, '0').replace(/[IL]/g, '1');
}

export function validateUsername(raw: string): string {
  const u = raw.trim().toLowerCase();
  if (!/^[a-z0-9_.-]{3,30}$/.test(u)) throw new AuthError('Username: 3-30 characters, letters, numbers, dot, dash or underscore', 'username');
  return u;
}
export function validatePassword(p: string): void {
  if (p.length < PASSWORD_MIN) throw new AuthError(`Use at least ${PASSWORD_MIN} characters`, 'password');
  if (p.length > PASSWORD_MAX) throw new AuthError(`Use at most ${PASSWORD_MAX} characters`, 'password');
}

export interface AuthOptions { now?: () => number; pwIterations?: number; tokenIterations?: number }

export class AuthService {
  private db: SqlDb;
  private now: () => number;
  private pwIter: number;
  private tokIter: number;
  private dummy: Promise<{ salt: Uint8Array }>;

  constructor(db: SqlDb, opts: AuthOptions = {}) {
    this.db = db;
    this.now = opts.now ?? Date.now;
    this.pwIter = opts.pwIterations ?? PW_ITERATIONS;
    this.tokIter = opts.tokenIterations ?? TOKEN_ITERATIONS;
    this.dummy = Promise.resolve({ salt: randomBytes(16) });
  }

  private toAccount(r: Row): Account { return { id: r.id, username: r.username, dbName: r.db_name, biometric: !!r.bio_hash }; }

  async listAccounts(): Promise<Account[]> {
    return (await this.db.all<Row>('SELECT * FROM accounts ORDER BY created_at')).map((r) => this.toAccount(r));
  }
  async count(): Promise<number> { return (await one<{ n: number }>(this.db, 'SELECT count(*) AS n FROM accounts'))!.n; }

  private async byName(username: string): Promise<Row | null> {
    return one<Row>(this.db, 'SELECT * FROM accounts WHERE username = ?', [username.trim().toLowerCase()]);
  }
  private async byId(id: string): Promise<Row | null> { return one<Row>(this.db, 'SELECT * FROM accounts WHERE id = ?', [id]); }

  async createAccount(usernameRaw: string, password: string): Promise<{ account: Account; recoveryCode: string }> {
    const username = validateUsername(usernameRaw);
    validatePassword(password);
    if (await this.byName(username)) throw new AuthError('That username is already used on this phone.', 'taken');
    const id = uuid();
    const dbName = 'acct_' + id.replace(/-/g, '').slice(0, 24);
    const pwSalt = randomBytes(16), recSalt = randomBytes(16);
    const code = generateRecoveryCode();
    await this.db.run(
      'INSERT INTO accounts (id, username, db_name, pw_salt, pw_hash, pw_iter, rec_salt, rec_hash, rec_iter) VALUES (?,?,?,?,?,?,?,?,?)',
      [id, username, dbName, toBase64(pwSalt), toBase64(await pbkdf2(password, pwSalt, this.pwIter)), this.pwIter, toBase64(recSalt), toBase64(await pbkdf2(normalizeRecoveryCode(code), recSalt, this.tokIter)), this.tokIter],
    );
    return { account: { id, username, dbName, biometric: false }, recoveryCode: code };
  }

  private lockRemaining(r: Row): number { return Math.max(0, r.locked_until - this.now()); }

  private async fail(r: Row): Promise<{ ok: false; reason: 'invalid' | 'locked'; retryInMs?: number; attemptsLeft?: number }> {
    const n = r.failed_count + 1;
    let until = 0;
    if (n >= MAX_FREE_ATTEMPTS) until = this.now() + Math.min(MAX_LOCK_MS, 30_000 * 2 ** (n - MAX_FREE_ATTEMPTS));
    await this.db.run('UPDATE accounts SET failed_count = ?, locked_until = ? WHERE id = ?', [n, until, r.id]);
    if (until) return { ok: false, reason: 'locked', retryInMs: until - this.now() };
    return { ok: false, reason: 'invalid', attemptsLeft: MAX_FREE_ATTEMPTS - n };
  }
  private async succeed(r: Row) {
    await this.db.run("UPDATE accounts SET failed_count = 0, locked_until = 0, last_login_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?", [r.id]);
  }

  private async check(r: Row, kind: 'pw' | 'rec' | 'bio', secret: string): Promise<boolean> {
    const salt = kind === 'pw' ? r.pw_salt : kind === 'rec' ? r.rec_salt : r.bio_salt;
    const hash = kind === 'pw' ? r.pw_hash : kind === 'rec' ? r.rec_hash : r.bio_hash;
    const iter = kind === 'pw' ? r.pw_iter : kind === 'rec' ? r.rec_iter : r.bio_iter;
    if (!salt || !hash || !iter) return false;
    return timingSafeEqual(await pbkdf2(secret, fromBase64(salt), iter), fromBase64(hash));
  }

  /** Same amount of work for unknown usernames so the answer time does not reveal which usernames exist. */
  private async burn(secret: string) { await pbkdf2(secret, (await this.dummy).salt, this.pwIter); }

  async login(username: string, password: string): Promise<LoginResult> {
    const r = await this.byName(username);
    if (!r) { await this.burn(password); return { ok: false, reason: 'invalid' }; }
    const wait = this.lockRemaining(r);
    if (wait > 0) return { ok: false, reason: 'locked', retryInMs: wait };
    if (!(await this.check(r, 'pw', password))) return this.fail(r);
    await this.succeed(r);
    return { ok: true, account: this.toAccount(r) };
  }

  async loginWithBiometricToken(accountId: string, token: string): Promise<LoginResult> {
    const r = await this.byId(accountId);
    if (!r || !r.bio_hash) return { ok: false, reason: 'invalid' };
    const wait = this.lockRemaining(r);
    if (wait > 0) return { ok: false, reason: 'locked', retryInMs: wait };
    if (!(await this.check(r, 'bio', token))) return this.fail(r);
    await this.succeed(r);
    return { ok: true, account: this.toAccount(r) };
  }

  /** Verifies the password for a sensitive action by an already signed-in user (shares the lockout). */
  async confirmPassword(accountId: string, password: string): Promise<void> {
    const r = await this.byId(accountId);
    if (!r) throw new AuthError('Account not found.', 'missing');
    const wait = this.lockRemaining(r);
    if (wait > 0) throw new AuthError(lockMessage(wait), 'locked', wait);
    if (!(await this.check(r, 'pw', password))) {
      const f = await this.fail(r);
      throw new AuthError(f.reason === 'locked' ? lockMessage(f.retryInMs!) : 'Incorrect password.', f.reason === 'locked' ? 'locked' : 'invalid', f.retryInMs);
    }
    await this.succeed(r);
  }

  async changePassword(accountId: string, current: string, next: string): Promise<void> {
    validatePassword(next);
    await this.confirmPassword(accountId, current);
    await this.setPassword(accountId, next);
  }

  private async setPassword(accountId: string, next: string) {
    const salt = randomBytes(16);
    await this.db.run('UPDATE accounts SET pw_salt = ?, pw_hash = ?, pw_iter = ?, failed_count = 0, locked_until = 0 WHERE id = ?', [toBase64(salt), toBase64(await pbkdf2(next, salt, this.pwIter)), this.pwIter, accountId]);
  }

  private async newRecovery(accountId: string): Promise<string> {
    const code = generateRecoveryCode();
    const salt = randomBytes(16);
    await this.db.run('UPDATE accounts SET rec_salt = ?, rec_hash = ?, rec_iter = ? WHERE id = ?', [toBase64(salt), toBase64(await pbkdf2(normalizeRecoveryCode(code), salt, this.tokIter)), this.tokIter, accountId]);
    return code;
  }

  async regenerateRecoveryCode(accountId: string, password: string): Promise<string> {
    await this.confirmPassword(accountId, password);
    return this.newRecovery(accountId);
  }

  /** Forgot password: the recovery code proves ownership. The code is single-use: a fresh one is issued. */
  async resetWithRecovery(username: string, code: string, newPassword: string): Promise<{ account: Account; recoveryCode: string }> {
    validatePassword(newPassword);
    const r = await this.byName(username);
    if (!r) { await this.burn(code); throw new AuthError('That username or recovery code is not right.', 'invalid'); }
    const wait = this.lockRemaining(r);
    if (wait > 0) throw new AuthError(lockMessage(wait), 'locked', wait);
    if (!(await this.check(r, 'rec', normalizeRecoveryCode(code)))) {
      const f = await this.fail(r);
      throw new AuthError(f.reason === 'locked' ? lockMessage(f.retryInMs!) : 'That username or recovery code is not right.', f.reason === 'locked' ? 'locked' : 'invalid', f.retryInMs);
    }
    await this.setPassword(r.id, newPassword);
    const fresh = await this.newRecovery(r.id);
    await this.db.run('UPDATE accounts SET bio_salt = NULL, bio_hash = NULL, bio_iter = NULL WHERE id = ?', [r.id]); // biometrics must be set up again after a reset
    return { account: { ...this.toAccount(r), biometric: false }, recoveryCode: fresh };
  }

  async setBiometricToken(accountId: string, token: string | null): Promise<void> {
    if (token === null) { await this.db.run('UPDATE accounts SET bio_salt = NULL, bio_hash = NULL, bio_iter = NULL WHERE id = ?', [accountId]); return; }
    const salt = randomBytes(16);
    await this.db.run('UPDATE accounts SET bio_salt = ?, bio_hash = ?, bio_iter = ? WHERE id = ?', [toBase64(salt), toBase64(await pbkdf2(token, salt, this.tokIter)), this.tokIter, accountId]);
  }

  async deleteAccount(accountId: string, password: string): Promise<Account> {
    await this.confirmPassword(accountId, password);
    const r = (await this.byId(accountId))!;
    await this.db.run('DELETE FROM accounts WHERE id = ?', [accountId]);
    return this.toAccount(r);
  }

  /** Used by restore: re-attach a freshly restored account with a new password. */
  async lockInfo(username: string): Promise<{ locked: boolean; retryInMs: number }> {
    const r = await this.byName(username);
    const ms = r ? this.lockRemaining(r) : 0;
    return { locked: ms > 0, retryInMs: ms };
  }
}

export function lockMessage(ms: number): string {
  const s = Math.ceil(ms / 1000);
  return s < 90 ? `Too many attempts. Try again in ${s} seconds.` : `Too many attempts. Try again in ${Math.ceil(s / 60)} minutes.`;
}
