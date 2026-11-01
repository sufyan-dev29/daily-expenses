'use client';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { AuthError, lockMessage, type Account, type AuthService } from '@/core/auth';
import { seedStarterOptions } from '@/core/seeding';
import { openBackup, restoreData, type BackupData } from '@/core/backup';
import { boot, closeSession, eraseAccountData, getDb, openAccountSession } from '@/lib/local/runtime';
import { startSyncTriggers } from '@/lib/local/sync';
import { consumeAutoLockHold, onAppActive, store } from '@/lib/local/platform';
import { biometricRemove, biometricUnlock, BiometricError } from '@/lib/local/biometric';
import { applyMode } from '@/lib/local/account';

export type Mode = 'offline' | 'online';
type Phase = 'booting' | 'failed' | 'auth' | 'app';

interface Ctx {
  phase: Phase;
  bootError: string;
  auth: AuthService | null;
  accounts: Account[];
  account: Account | null;
  lastUsername: string;
  lastMode: Mode;
  /** Shown once after sign-up / reset / restore; the app waits until the user confirms they saved it. */
  recoveryCode: string | null;
  confirmRecoveryCode: () => void;
  signIn: (username: string, password: string, mode: Mode) => Promise<string | null>;
  signInBiometric: (mode: Mode) => Promise<string | null>;
  createAccount: (username: string, password: string, mode: Mode) => Promise<string | null>;
  resetWithRecovery: (username: string, code: string, newPassword: string) => Promise<string | null>;
  restoreNewAccount: (file: Uint8Array, backupPassword: string, username: string, password: string) => Promise<string | null>;
  signOut: () => Promise<void>;
  deleteAccount: (password: string) => Promise<string | null>;
  refreshAccounts: () => Promise<void>;
  autoLockSeconds: number;
  setAutoLockSeconds: (s: number) => void;
}

const SessionCtx = createContext<Ctx | null>(null);
export const useSession = () => {
  const c = useContext(SessionCtx);
  if (!c) throw new Error('useSession outside provider');
  return c;
};

const msgOf = (e: unknown) => (e instanceof AuthError || e instanceof BiometricError ? e.message : (e as Error)?.message || 'Something went wrong.');

export function SessionProvider({ children }: { children: ReactNode }) {
  const [phase, setPhase] = useState<Phase>('booting');
  const [bootError, setBootError] = useState('');
  const [auth, setAuth] = useState<AuthService | null>(null);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [account, setAccount] = useState<Account | null>(null);
  const [recoveryCode, setRecoveryCode] = useState<string | null>(null);
  const [autoLock, setAutoLock] = useState(60);
  const afterRecovery = useRef<(() => void) | null>(null);
  const stopSync = useRef<(() => void) | null>(null);
  const authRef = useRef<AuthService | null>(null);

  useEffect(() => {
    const v = Number(store.get('et-autolock'));
    if (store.get('et-autolock') !== null && Number.isFinite(v)) setAutoLock(v);
    let alive = true;
    boot().then(async (a) => {
      if (!alive) return;
      authRef.current = a; setAuth(a);
      setAccounts(await a.listAccounts());
      setPhase('auth');
    }).catch((e) => { if (alive) { setBootError(msgOf(e)); setPhase('failed'); } });
    return () => { alive = false; };
  }, []);

  const refreshAccounts = useCallback(async () => { if (authRef.current) setAccounts(await authRef.current.listAccounts()); }, []);

  const enter = useCallback(async (acct: Account, mode: Mode | null, seed = false) => {
    await openAccountSession(acct);
    if (seed) await seedStarterOptions(getDb());
    if (mode) await applyMode(mode);
    store.set('et-last-user', acct.username);
    if (mode) store.set('et-mode', mode);
    setAccount(acct);
    stopSync.current?.();
    stopSync.current = startSyncTriggers();
    setPhase('app');
  }, []);

  const signOut = useCallback(async () => {
    stopSync.current?.(); stopSync.current = null;
    // Load the account list first so the sign-in screen opens on "Sign in", not "Create account".
    const list = authRef.current ? await authRef.current.listAccounts() : [];
    // Unmount the signed-in screens before closing the database so nothing touches it while it closes.
    setAccounts(list);
    setPhase('auth');
    setAccount(null);
    setRecoveryCode(null);
    await new Promise((r) => setTimeout(r, 80));
    document.getElementById('user-theme')?.remove();
    await closeSession();
  }, [refreshAccounts]);

  // Lock after the app has been in the background for a while.
  useEffect(() => {
    if (phase !== 'app') return;
    let hiddenAt: number | null = null;
    return onAppActive((active) => {
      if (!active) { hiddenAt = Date.now(); return; }
      const held = consumeAutoLockHold();
      if (!held && hiddenAt !== null && autoLock >= 0 && Date.now() - hiddenAt >= autoLock * 1000) void signOut();
      hiddenAt = null;
    });
  }, [phase, autoLock, signOut]);

  const withRecovery = (code: string, then: () => void) => {
    afterRecovery.current = then;
    setRecoveryCode(code);
  };

  const value = useMemo<Ctx>(() => ({
    phase, bootError, auth, accounts, account,
    lastUsername: store.get('et-last-user') ?? accounts[accounts.length - 1]?.username ?? '',
    lastMode: store.get('et-mode') === 'online' ? 'online' : 'offline',
    recoveryCode,
    confirmRecoveryCode: () => { const f = afterRecovery.current; afterRecovery.current = null; setRecoveryCode(null); f?.(); },
    autoLockSeconds: autoLock,
    setAutoLockSeconds: (s) => { store.set('et-autolock', String(s)); setAutoLock(s); },
    refreshAccounts,

    async signIn(username, password, mode) {
      const a = authRef.current!;
      try {
        const r = await a.login(username, password);
        if (!r.ok) return r.reason === 'locked' ? lockMessage(r.retryInMs ?? 30_000) : `Incorrect username or password.${r.attemptsLeft !== undefined && r.attemptsLeft <= 2 ? ` ${r.attemptsLeft} ${r.attemptsLeft === 1 ? 'try' : 'tries'} left before a short lock.` : ''}`;
        await enter(r.account, mode);
        return null;
      } catch (e) { return msgOf(e); }
    },

    async signInBiometric(mode) {
      const a = authRef.current!;
      const acct = (await a.listAccounts()).find((x) => x.biometric && x.username === (store.get('et-last-user') ?? ''));
      if (!acct) return 'Turn on biometric sign-in in Settings first.';
      try {
        const token = await biometricUnlock(acct.id);
        const r = await a.loginWithBiometricToken(acct.id, token);
        if (!r.ok) return r.reason === 'locked' ? lockMessage(r.retryInMs ?? 30_000) : 'Biometric sign-in did not match. Use your password.';
        await enter(r.account, mode);
        return null;
      } catch (e) { return e instanceof BiometricError && e.code === 'cancelled' ? '' : msgOf(e); }
    },

    async createAccount(username, password, mode) {
      const a = authRef.current!;
      try {
        const { account: acct, recoveryCode: code } = await a.createAccount(username, password);
        await enter(acct, mode, true);
        withRecovery(code, () => {});
        return null;
      } catch (e) { return msgOf(e); }
    },

    async resetWithRecovery(username, code, newPassword) {
      const a = authRef.current!;
      try {
        const { account: acct, recoveryCode: fresh } = await a.resetWithRecovery(username, code, newPassword);
        await biometricRemove(acct.id);
        await enter(acct, null);
        withRecovery(fresh, () => {});
        return null;
      } catch (e) { return msgOf(e); }
    },

    async restoreNewAccount(file, backupPassword, username, password) {
      const a = authRef.current!;
      try {
        const { data } = await openBackup(file, backupPassword);
        const { account: acct, recoveryCode: code } = await a.createAccount(username, password);
        try {
          await openAccountSession(acct);
          await restoreData(getDb(), data as BackupData, 'replace');
        } catch (e) {
          await a.setBiometricToken(acct.id, null); // keep the registry tidy
          await a.deleteAccount(acct.id, password).catch(() => {});
          await eraseAccountData(acct).catch(() => {});
          throw e;
        }
        store.set('et-last-user', acct.username);
        setAccount(acct);
        stopSync.current?.(); stopSync.current = startSyncTriggers();
        setPhase('app');
        withRecovery(code, () => {});
        return null;
      } catch (e) { return msgOf(e); }
    },

    signOut,

    async deleteAccount(password) {
      const a = authRef.current!;
      if (!account) return 'Not signed in.';
      try {
        const acct = await a.deleteAccount(account.id, password);
        await biometricRemove(acct.id);
        stopSync.current?.(); stopSync.current = null;
        await eraseAccountData(acct);
        document.getElementById('user-theme')?.remove();
        setAccount(null);
        await refreshAccounts();
        setPhase('auth');
        return null;
      } catch (e) { return msgOf(e); }
    },
  }), [phase, bootError, auth, accounts, account, recoveryCode, autoLock, enter, signOut, refreshAccounts]);

  return <SessionCtx.Provider value={value}>{children}</SessionCtx.Provider>;
}
