'use client';
import { useEffect, useState, type ReactNode } from 'react';
import { Button, Field, Icon, Segmented } from '@/components/ui';
import { useSession, type Mode } from '@/components/auth/SessionProvider';
import { openBackup, type BackupHeader } from '@/core/backup';
import { biometricAvailable } from '@/lib/local/biometric';
import { pickFile, readBytes } from '@/lib/local/platform';

export function Shell({ children }: { children: ReactNode }) {
  return (
    <main className="flex min-h-dvh items-center justify-center bg-surface-container-low px-4 py-10">
      <div className="w-full max-w-[400px] rounded-m3-xl bg-surface p-6 medium:p-8">
        <div className="mb-6 flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-full bg-primary-container text-on-primary-container t-label-lg">Rs</span>
          <span className="t-title-md">Daily Expenses</span>
        </div>
        {children}
      </div>
    </main>
  );
}

type View = 'login' | 'create' | 'forgot' | 'restore';

function ModePicker({ mode, onChange }: { mode: Mode; onChange: (m: Mode) => void }) {
  return (
    <div>
      <Segmented
        label="Mode"
        value={mode}
        onChange={onChange}
        options={[{ value: 'offline', label: 'Offline', icon: 'cloud_off' }, { value: 'online', label: 'Online', icon: 'cloud_sync' }]}
      />
      <p className="t-body-md mt-2 text-on-surface-variant">
        {mode === 'offline' ? 'Everything stays on this phone.' : 'Also keeps a copy in your own Google Sheet. Needs a Google service account (set up in Settings).'}
      </p>
    </div>
  );
}

export function AuthScreens() {
  const s = useSession();
  const [view, setView] = useState<View>(s.accounts.length ? 'login' : 'create');
  useEffect(() => { if (!s.accounts.length && view === 'login') setView('create'); }, [s.accounts.length, view]);
  const [notice, setNotice] = useState('');
  const go = (v: View) => { setNotice(''); setView(v); };
  return (
    <Shell>
      {view === 'login' && <Login go={go} notice={notice} />}
      {view === 'create' && <Create go={go} first={!s.accounts.length} />}
      {view === 'forgot' && <Forgot go={go} />}
      {view === 'restore' && <RestoreNew go={go} />}
    </Shell>
  );
}

function LinkButton({ children, onClick }: { children: ReactNode; onClick: () => void }) {
  return <button type="button" onClick={onClick} className="t-label-lg state self-center rounded-full px-3 py-3 text-primary">{children}</button>;
}

function Login({ go, notice }: { go: (v: View) => void; notice: string }) {
  const s = useSession();
  const [username, setUsername] = useState(s.lastUsername);
  const [password, setPassword] = useState('');
  const [mode, setMode] = useState<Mode>(s.lastMode);
  const [error, setError] = useState(notice);
  const [busy, setBusy] = useState(false);
  const [bio, setBio] = useState(false);
  useEffect(() => {
    const acct = s.accounts.find((a) => a.username === username.trim().toLowerCase());
    if (!acct?.biometric) { setBio(false); return; }
    biometricAvailable().then(setBio);
  }, [username, s.accounts]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setError('');
    const err = await s.signIn(username, password, mode);
    if (err) { setError(err); setBusy(false); setPassword(''); }
  };
  const viaBio = async () => {
    setBusy(true); setError('');
    const err = await s.signInBiometric(mode);
    if (err !== null) { setError(err); setBusy(false); }
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <h1 className="t-headline">Sign in</h1>
      <ModePicker mode={mode} onChange={setMode} />
      <Field label="Username" value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" autoCapitalize="none" autoCorrect="off" spellCheck={false} required data-testid="login-username" />
      <Field label="Password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required error={error || undefined} data-testid="login-password" />
      <Button type="submit" className="h-14" disabled={busy || !username || !password} data-testid="login-submit">{busy ? 'Signing in…' : 'Sign in'}</Button>
      {bio && <Button type="button" variant="outlined" className="h-14" icon="fingerprint" onClick={viaBio} disabled={busy} data-testid="login-biometric">Use fingerprint or face</Button>}
      <LinkButton onClick={() => go('forgot')}>Forgot password?</LinkButton>
      <div className="flex flex-wrap justify-center gap-x-2 border-t border-outline-variant/40 pt-2">
        <LinkButton onClick={() => go('create')}>New account</LinkButton>
        <LinkButton onClick={() => go('restore')}>Restore from backup</LinkButton>
      </div>
    </form>
  );
}

function Create({ go, first }: { go: (v: View) => void; first: boolean }) {
  const s = useSession();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [again, setAgain] = useState('');
  const [mode, setMode] = useState<Mode>('offline');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password !== again) return setError('Passwords do not match.');
    setBusy(true); setError('');
    const err = await s.createAccount(username, password, mode);
    if (err) { setError(err); setBusy(false); }
  };
  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <h1 className="t-headline">{first ? 'Welcome' : 'New account'}</h1>
      <p className="t-body-lg text-on-surface-variant">Your account and all your data stay on this phone, encrypted. There is no email and no online account.</p>
      <ModePicker mode={mode} onChange={setMode} />
      <Field label="Username" value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" autoCapitalize="none" autoCorrect="off" spellCheck={false} required hint="3-30 letters, numbers, dot, dash or underscore" data-testid="create-username" />
      <Field label="Password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" required hint="At least 10 characters" data-testid="create-password" />
      <Field label="Confirm password" type="password" value={again} onChange={(e) => setAgain(e.target.value)} autoComplete="new-password" required error={error || undefined} data-testid="create-confirm" />
      <Button type="submit" className="h-14" disabled={busy || !username || password.length < 10 || !again} data-testid="create-submit">{busy ? 'Creating…' : 'Create account'}</Button>
      {!first && <LinkButton onClick={() => go('login')}>Back to sign in</LinkButton>}
      {first && <LinkButton onClick={() => go('restore')}>I have a backup to restore</LinkButton>}
    </form>
  );
}

function Forgot({ go }: { go: (v: View) => void }) {
  const s = useSession();
  const [username, setUsername] = useState(s.lastUsername);
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [again, setAgain] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password !== again) return setError('Passwords do not match.');
    setBusy(true); setError('');
    const err = await s.resetWithRecovery(username, code, password);
    if (err) { setError(err); setBusy(false); }
  };
  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <h1 className="t-headline">Reset password</h1>
      <p className="t-body-lg text-on-surface-variant">Enter the recovery code you saved when you made this account. Without it, or a backup, the data cannot be recovered.</p>
      <Field label="Username" value={username} onChange={(e) => setUsername(e.target.value)} autoCapitalize="none" autoCorrect="off" spellCheck={false} required />
      <Field label="Recovery code" value={code} onChange={(e) => setCode(e.target.value)} autoCapitalize="characters" autoCorrect="off" spellCheck={false} required placeholder="XXXXX-XXXXX-XXXXX-XXXXX" className="font-mono" data-testid="forgot-code" />
      <Field label="New password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" required hint="At least 10 characters" />
      <Field label="Confirm new password" type="password" value={again} onChange={(e) => setAgain(e.target.value)} autoComplete="new-password" required error={error || undefined} />
      <Button type="submit" className="h-14" disabled={busy || !username || !code || password.length < 10 || !again} data-testid="forgot-submit">{busy ? 'Checking…' : 'Reset password'}</Button>
      <LinkButton onClick={() => go('login')}>Back to sign in</LinkButton>
    </form>
  );
}

function RestoreNew({ go }: { go: (v: View) => void }) {
  const s = useSession();
  const [file, setFile] = useState<{ name: string; bytes: Uint8Array } | null>(null);
  const [bpw, setBpw] = useState('');
  const [info, setInfo] = useState<{ header: BackupHeader; username: string } | null>(null);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [again, setAgain] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const choose = async () => {
    setError('');
    try {
      const f = await pickFile('.zip,application/zip,application/octet-stream');
      if (f) { setFile({ name: f.name, bytes: await readBytes(f) }); setInfo(null); }
    } catch (e) { setError((e as Error).message); }
  };
  const unlock = async () => {
    if (!file) return;
    setBusy(true); setError('');
    try {
      const { header, data } = await openBackup(file.bytes, bpw);
      setInfo({ header, username: data.account.username });
      setUsername(data.account.username);
    } catch (e) { setError((e as Error).message); }
    setBusy(false);
  };
  const restore = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password !== again) return setError('Passwords do not match.');
    setBusy(true); setError('');
    const err = await s.restoreNewAccount(file!.bytes, bpw, username, password);
    if (err) { setError(err); setBusy(false); }
  };

  if (!info) {
    return (
      <div className="flex flex-col gap-4">
        <h1 className="t-headline">Restore from backup</h1>
        <p className="t-body-lg text-on-surface-variant">Choose a Daily Expenses backup file (.zip) and enter the backup password you set when you made it.</p>
        <Button variant="outlined" className="h-14" icon="folder_open" onClick={choose} data-testid="restore-choose">{file ? file.name : 'Choose backup file'}</Button>
        <Field label="Backup password" type="password" value={bpw} onChange={(e) => setBpw(e.target.value)} autoComplete="off" error={error || undefined} data-testid="restore-password" />
        <Button className="h-14" onClick={unlock} disabled={busy || !file || !bpw} data-testid="restore-open">{busy ? 'Opening…' : 'Open backup'}</Button>
        <LinkButton onClick={() => go(s.accounts.length ? 'login' : 'create')}>Back</LinkButton>
      </div>
    );
  }
  return (
    <form onSubmit={restore} className="flex flex-col gap-4">
      <h1 className="t-headline">Backup found</h1>
      <p className="t-body-lg rounded-2xl bg-secondary-container px-4 py-3 text-on-secondary-container">
        <Icon name="inventory_2" size={18} /> {info.header.counts.transactions.toLocaleString()} entries, {info.header.counts.options} list items, {info.header.counts.templates} templates. Made {new Date(info.header.createdAt).toLocaleDateString()}.
      </p>
      <p className="t-body-lg text-on-surface-variant">Choose the username and password for this phone. Fingerprint sign-in does not travel with a backup; turn it on again in Settings.</p>
      <Field label="Username" value={username} onChange={(e) => setUsername(e.target.value)} autoCapitalize="none" required />
      <Field label="New app password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" required hint="At least 10 characters" />
      <Field label="Confirm password" type="password" value={again} onChange={(e) => setAgain(e.target.value)} autoComplete="new-password" required error={error || undefined} />
      <Button type="submit" className="h-14" disabled={busy || !username || password.length < 10 || !again} data-testid="restore-submit">{busy ? 'Restoring…' : 'Restore'}</Button>
      <LinkButton onClick={() => { setInfo(null); setError(''); }}>Back</LinkButton>
    </form>
  );
}
