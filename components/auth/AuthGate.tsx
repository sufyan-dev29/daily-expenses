'use client';
import { useState, type ReactNode } from 'react';
import { Button, Spinner } from '@/components/ui';
import { useSession } from '@/components/auth/SessionProvider';
import { AuthScreens, Shell } from '@/components/auth/AuthScreens';

export function AuthGate({ children }: { children: ReactNode }) {
  const s = useSession();
  if (s.phase === 'booting') return <Shell><div className="flex justify-center py-10"><Spinner size={32} /></div></Shell>;
  if (s.phase === 'failed') return <Shell><h1 className="t-headline">Could not open your data</h1><p className="t-body-lg mt-3 text-on-surface-variant">{s.bootError || 'The secure storage on this phone could not be opened.'}</p><Button className="mt-5 h-14 w-full" onClick={() => window.location.reload()}>Try again</Button></Shell>;
  if (s.phase === 'auth') return <AuthScreens />;
  if (s.recoveryCode) return <RecoveryCodeScreen />;
  return <>{children}</>;
}

function RecoveryCodeScreen() {
  const s = useSession();
  const [saved, setSaved] = useState(false);
  const [copied, setCopied] = useState(false);
  const code = s.recoveryCode ?? '';
  const copy = async () => {
    try { await navigator.clipboard.writeText(code); setCopied(true); } catch { setCopied(false); }
  };
  return (
    <Shell>
      <h1 className="t-headline">Save your recovery code</h1>
      <p className="t-body-lg mt-3 text-on-surface-variant">
        Your data lives only on this phone, so there is no email reset. This code is the only way back in if you forget your password.
      </p>
      <div className="mt-5 select-all rounded-2xl bg-surface-container-high px-4 py-5 text-center font-mono text-[22px] font-semibold tracking-wider" data-testid="recovery-code">{code}</div>
      <div className="mt-3 flex gap-2">
        <Button variant="tonal" icon="content_copy" onClick={copy}>{copied ? 'Copied' : 'Copy'}</Button>
      </div>
      <p className="t-body-md mt-4 rounded-2xl bg-error-container px-4 py-3 text-on-error-container">
        Write it down or store it in a password manager. If you lose your password, this code and all your backups, your data cannot be recovered by anyone.
      </p>
      <label className="t-body-lg mt-5 flex items-start gap-3">
        <input type="checkbox" className="mt-1 h-5 w-5 accent-[var(--md-sys-color-primary)]" checked={saved} onChange={(e) => setSaved(e.target.checked)} data-testid="recovery-saved" />
        I have saved my recovery code
      </label>
      <Button className="mt-5 h-14 w-full" disabled={!saved} onClick={s.confirmRecoveryCode} data-testid="recovery-continue">Continue</Button>
    </Shell>
  );
}
