'use client';
/**
 * SqlDb on top of @capacitor-community/sqlite (SQLCipher). One encrypted file per account.
 * The database key is a random passphrase that the plugin keeps in the Android Keystore; it never appears in JS.
 */
import { CapacitorSQLite, SQLiteConnection, type SQLiteDBConnection } from '@capacitor-community/sqlite';
import type { SqlDb, SqlValue } from '@/core/db';

const sqlite = new SQLiteConnection(CapacitorSQLite);

function randomPassphrase(): string {
  const b = new Uint8Array(32);
  crypto.getRandomValues(b);
  return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
}

let secretReady: Promise<void> | null = null;
function ensureSecret(): Promise<void> {
  secretReady ??= (async () => {
    const { result } = await sqlite.isSecretStored();
    if (!result) await sqlite.setEncryptionSecret(randomPassphrase());
  })();
  return secretReady;
}

export class CapDb implements SqlDb {
  readonly name: string;
  private conn: SQLiteDBConnection;
  private inTx = false;
  private chain: Promise<void> = Promise.resolve();

  constructor(name: string, conn: SQLiteDBConnection) { this.name = name; this.conn = conn; }

  async run(sql: string, params: SqlValue[] = []) {
    const r = await this.conn.run(sql, params, !this.inTx, 'no');
    return { changes: r.changes?.changes ?? 0 };
  }
  async all<T = Record<string, unknown>>(sql: string, params: SqlValue[] = []): Promise<T[]> {
    const r = await this.conn.query(sql, params);
    return ((r.values ?? []) as unknown[]).filter((row) => !(row && typeof row === 'object' && 'ios_columns' in (row as object))) as T[];
  }
  async runMany(sql: string, sets: SqlValue[][]) {
    if (!sets.length) return;
    await this.conn.executeSet(sets.map((values) => ({ statement: sql, values })), !this.inTx, 'no');
  }
  async exec(sql: string) { await this.conn.execute(sql, !this.inTx); }

  async transaction<T>(fn: () => Promise<T>): Promise<T> {
    const previous = this.chain;
    let release!: () => void;
    this.chain = new Promise<void>((r) => { release = r; });
    await previous;
    this.inTx = true;
    try {
      await this.conn.beginTransaction();
      let out: T;
      try { out = await fn(); } catch (e) { await this.conn.rollbackTransaction().catch(() => {}); throw e; }
      await this.conn.commitTransaction();
      return out;
    } finally {
      this.inTx = false;
      release();
    }
  }

  async close() { await sqlite.closeConnection(this.name, false).catch(() => {}); }
}

export async function openDatabase(name: string): Promise<CapDb> {
  await ensureSecret();
  const consistent = (await sqlite.checkConnectionsConsistency().catch(() => ({ result: false }))).result;
  const exists = consistent ? (await sqlite.isConnection(name, false)).result : false;
  const conn = exists ? await sqlite.retrieveConnection(name, false) : await sqlite.createConnection(name, true, 'secret', 1, false);
  await conn.open();
  await conn.execute('PRAGMA foreign_keys = ON;', false);
  return new CapDb(name, conn);
}

export async function deleteDatabase(name: string): Promise<void> {
  await ensureSecret();
  const exists = (await sqlite.isConnection(name, false)).result;
  const conn = exists ? await sqlite.retrieveConnection(name, false) : await sqlite.createConnection(name, true, 'secret', 1, false);
  await conn.open().catch(() => {});
  await conn.delete().catch(() => {});
  await sqlite.closeConnection(name, false).catch(() => {});
}
