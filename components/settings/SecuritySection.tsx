'use client';
import { useEffect, useState } from 'react';
import { Button, Field, Icon, Section, Segmented, Sheet, Switch, useSnackbar } from '@/components/ui';
import { useSession } from '@/components/auth/SessionProvider';
import { AuthError } from '@/core/auth';
import { randomBytes, toBase64 } from '@/core/bytes';
import { biometricAvailable, biometricEnroll, biometricRemove, BiometricError } from '@/lib/local/biometric';

function Err({ text }: { text: string }) {
  return <p role="alert" className="t-body-md mt-3 flex items-start gap-2 rounded-2xl bg-error-container px-3 py-2 text-on-error-container"><Icon name="error" size={20} />{text}</p>;
}
const msgOf = (e: unknown) => (e instanceof AuthError || e instanceof BiometricError ? e.message : (e as Error)?.message || 'Something went wrong.');

type Dialog = null | 'password' | 'recovery' | 'delete' | 'bio';

export function SecuritySection() {
  const s = useSession();
  const snack = useSnackbar();
  const [avail, setAvail] = useState(false);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [cur, setCur] = useState('');
  const [next, setNext] = useState('');
  const [again, setAgain] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [code, setCode] = useState('');
  const acct = s.account!;
  const enabled = s.accounts.find((a) => a.id === acct.id)?.biometric ?? false;

  useEffect(() => { void biometricAvailable().then(setAvail); }, []);
  const close = () => { setDialog(null); setCur(''); setNext(''); setAgain(''); setError(''); setCode(''); };

  const enableBio = async () => {
    setBusy(true); setError('');
    try {
      await s.auth!.confirmPassword(acct.id, cur);
      const token = toBase64(randomBytes(32));
      await s.auth!.setBiometricToken(acct.id, token);
      try { await biometricEnroll(acct.id, token); }
      catch (e) { await s.auth!.setBiometricToken(acct.id, null); throw e; }
      await s.refreshAccounts();
      snack({ message: 'Biometric sign-in is on.' });
      close();
    } catch (e) { setError(msgOf(e)); }
    setBusy(false);
  };
  const disableBio = async () => {
    await s.auth!.setBiometricToken(acct.id, null);
    await biometricRemove(acct.id);
    await s.refreshAccounts();
    snack({ message: 'Biometric sign-in is off.' });
  };
  const changePw = async () => {
    if (next !== again) return setError('Passwords do not match.');
    setBusy(true); setError('');
    try { await s.auth!.changePassword(acct.id, cur, next); snack({ message: 'Password changed.' }); close(); } catch (e) { setError(msgOf(e)); }
    setBusy(false);
  };
  const newCode = async () => {
    setBusy(true); setError('');
    try { setCode(await s.auth!.regenerateRecoveryCode(acct.id, cur)); } catch (e) { setError(msgOf(e)); }
    setBusy(false);
  };
  const del = async () => {
    setBusy(true); setError('');
    const err = await s.deleteAccount(cur);
    if (err) { setError(err); setBusy(false); }
  };

  const row = 'flex min-h-[56px] items-center justify-between gap-4 py-1';
  return (
    <>
      <Section title="Security" icon="shield_lock" description="Your data is encrypted on this phone. Sign-in is checked on the phone only.">
        <div className={row}>
          <div className="min-w-0"><div className="t-body-lg">Biometric sign-in</div><div className="t-body-md text-on-surface-variant">{avail ? 'Fingerprint or face instead of typing your password.' : 'Not available on this phone.'}</div></div>
          <Switch label="Biometric sign-in" checked={enabled} onChange={(v) => (v ? setDialog('bio') : void disableBio())} />
        </div>
        <div className={row}>
          <div className="min-w-0"><div className="t-body-lg">Lock after</div><div className="t-body-md text-on-surface-variant">When the app is in the background</div></div>
          <select aria-label="Auto lock" className="t-body-lg h-12 rounded-2xl border-2 border-transparent bg-surface-container-high px-3 focus:border-primary focus:outline-none" value={s.autoLockSeconds} onChange={(e) => s.setAutoLockSeconds(Number(e.target.value))}>
            <option value={0}>Immediately</option><option value={60}>1 minute</option><option value={300}>5 minutes</option><option value={1800}>30 minutes</option><option value={-1}>Never</option>
          </select>
        </div>
        <div className="mt-2 flex flex-wrap gap-2">
          <Button variant="outlined" icon="key" onClick={() => setDialog('password')} data-testid="change-password-open">Change password</Button>
          <Button variant="outlined" icon="lock_reset" onClick={() => setDialog('recovery')} data-testid="new-recovery-open">New recovery code</Button>
        </div>
      </Section>

      <Sheet open={dialog === 'bio'} onClose={close} title="Biometric sign-in" footer={<Button className="h-14 w-full" onClick={enableBio} disabled={busy || !cur}>{busy ? 'Waiting…' : 'Turn on'}</Button>}>
        <p className="t-body-lg text-on-surface-variant">Enter your password, then confirm with your fingerprint or face. If you add or remove fingerprints later, you will need to turn this on again.</p>
        <div className="mt-4"><Field label="Password" type="password" value={cur} onChange={(e) => setCur(e.target.value)} autoComplete="current-password" /></div>
        {error && <Err text={error} />}
      </Sheet>

      <Sheet open={dialog === 'password'} onClose={close} title="Change password" footer={<Button className="h-14 w-full" onClick={changePw} disabled={busy || !cur || next.length < 10 || !again} data-testid="change-password-run">{busy ? 'Saving…' : 'Change password'}</Button>}>
        <div className="flex flex-col gap-3">
          <Field label="Current password" type="password" value={cur} onChange={(e) => setCur(e.target.value)} autoComplete="current-password" data-testid="cp-current" />
          <Field label="New password" type="password" value={next} onChange={(e) => setNext(e.target.value)} autoComplete="new-password" hint="At least 10 characters" data-testid="cp-new" />
          <Field label="Confirm new password" type="password" value={again} onChange={(e) => setAgain(e.target.value)} autoComplete="new-password" data-testid="cp-confirm" />
        </div>
        {error && <Err text={error} />}
      </Sheet>

      <Sheet open={dialog === 'recovery'} onClose={close} title="New recovery code" footer={code ? <Button className="h-14 w-full" onClick={close}>I have saved it</Button> : <Button className="h-14 w-full" onClick={newCode} disabled={busy || !cur}>{busy ? 'Working…' : 'Make a new code'}</Button>}>
        {code ? (
          <>
            <p className="t-body-lg text-on-surface-variant">Your old code no longer works. Save this one:</p>
            <div className="mt-4 select-all rounded-2xl bg-surface-container-high px-4 py-5 text-center font-mono text-[22px] font-semibold tracking-wider" data-testid="new-recovery-code">{code}</div>
          </>
        ) : (
          <>
            <p className="t-body-lg text-on-surface-variant">Enter your password to make a new recovery code. The old code stops working.</p>
            <div className="mt-4"><Field label="Password" type="password" value={cur} onChange={(e) => setCur(e.target.value)} autoComplete="current-password" /></div>
          </>
        )}
        {error && <Err text={error} />}
      </Sheet>

      <Sheet open={dialog === 'delete'} onClose={close} title="Delete this account" footer={<Button className="h-14 w-full !bg-error !text-on-error" onClick={del} disabled={busy || !cur} data-testid="delete-run">{busy ? 'Deleting…' : 'Delete everything'}</Button>}>
        <p className="t-body-lg text-on-surface-variant">This permanently deletes the account and all its data from this phone. Backups you already saved are not affected. Enter your password to confirm.</p>
        <div className="mt-4"><Field label="Password" type="password" value={cur} onChange={(e) => setCur(e.target.value)} autoComplete="current-password" data-testid="delete-password" /></div>
        {error && <Err text={error} />}
      </Sheet>
      <DeleteHook open={() => setDialog('delete')} />
    </>
  );
}

/** Lets AccountSection open the delete dialog without duplicating state. */
function DeleteHook({ open }: { open: () => void }) {
  useEffect(() => {
    const f = () => open();
    window.addEventListener('et-delete-account', f);
    return () => window.removeEventListener('et-delete-account', f);
  }, [open]);
  return null;
}
