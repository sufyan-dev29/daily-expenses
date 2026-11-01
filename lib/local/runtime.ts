'use client';
import { AuthService, migrateAccounts, type Account } from '@/core/auth';
import { migrate } from '@/core/schema';
import { purgeTrash } from '@/core/maintenance';
import { localClient, type LocalClient } from '@/core/localclient';
import { CapDb, deleteDatabase, openDatabase } from '@/lib/local/capsqlite';

let booting: Promise<AuthService> | null = null;
let accountsDb: CapDb | null = null;

/** Opens the (encrypted) list of local accounts. Safe to call many times. */
export function boot(): Promise<AuthService> {
  booting ??= (async () => {
    accountsDb = await openDatabase('accounts');
    await migrateAccounts(accountsDb);
    return new AuthService(accountsDb);
  })().catch((e) => { booting = null; throw e; });
  return booting;
}

interface Session { account: Account; db: CapDb; client: LocalClient }
let session: Session | null = null;

export async function openAccountSession(account: Account): Promise<Session> {
  await closeSession();
  const db = await openDatabase(account.dbName);
  try {
    await migrate(db);
    await purgeTrash(db).catch(() => 0);
  } catch (e) { await db.close(); throw e; }
  session = { account, db, client: localClient(db) };
  return session;
}

export async function closeSession(): Promise<void> {
  const s = session;
  session = null;
  if (s) await s.db.close();
}

export async function eraseAccountData(account: Account): Promise<void> {
  if (session?.account.id === account.id) await closeSession();
  await deleteDatabase(account.dbName);
}

export function getSession(): Session {
  if (!session) throw new Error('Not signed in');
  return session;
}
export const hasSession = () => session !== null;
export const getDb = () => getSession().db;
