'use client';
import { useEffect, useState } from 'react';
import { Button, Field, Icon, Switch, cx } from '@/components/ui';

type Step = 0 | 1 | 2 | 3;
const STEPS = ['Token', 'Database', 'Owner', 'Done'];

async function call(body: unknown) {
  const res = await fetch('/api/setup', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const json = (await res.json().catch(() => ({}))) as { error?: string; applied?: string[] };
  return { ok: res.ok, ...json };
}

export default function SetupPage() {
  const [locked, setLocked] = useState<boolean | null>(null);
  const [step, setStep] = useState<Step>(0);
  const [token, setToken] = useState('');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [email, setEmail] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [seed, setSeed] = useState(true);

  useEffect(() => {
    fetch('/api/setup').then((r) => r.json()).then((j) => setLocked(j.locked)).catch(() => setLocked(false));
  }, []);

  const verify = async () => {
    setBusy(true); setMsg(null);
    const r = await call({ step: 'check', token });
    setBusy(false);
    if (!r.ok) return setMsg({ ok: false, text: r.error ?? 'Failed' });
    setStep(1);
  };
  const migrate = async () => {
    setBusy(true); setMsg(null);
    const r = await call({ step: 'migrate', token });
    setBusy(false);
    if (!r.ok) return setMsg({ ok: false, text: r.error ?? 'Failed' });
    setMsg({ ok: true, text: r.applied?.length ? `Applied ${r.applied.length} migration(s).` : 'Database is already up to date.' });
    setStep(2);
  };
  const createOwner = async () => {
    setBusy(true); setMsg(null);
    const r = await call({ step: 'owner', token, email, username, password, seed });
    setBusy(false);
    if (!r.ok) return setMsg({ ok: false, text: r.error ?? 'Failed' });
    setStep(3);
  };

  return (
    <main className="flex min-h-dvh items-center justify-center bg-surface-container-low px-4 py-10">
      <div className="w-full max-w-[480px] rounded-m3-xl bg-surface p-6 medium:p-8">
        <h1 className="t-headline mb-1">Set up your tracker</h1>

        {locked === null ? null : locked ? (
          <div className="mt-4 flex flex-col gap-3">
            <p className="t-body-lg text-on-surface-variant">Setup is already complete and has been locked.</p>
            <a href="/login" className="state t-label-lg inline-flex h-12 items-center justify-center rounded-full bg-primary px-6 text-on-primary">Go to sign in</a>
          </div>
        ) : (
          <>
            <ol className="my-5 flex items-center gap-2" aria-label="Progress">
              {STEPS.map((s, i) => (
                <li key={s} className="flex flex-1 items-center gap-2" aria-current={i === step ? 'step' : undefined}>
                  <span className={cx('t-label-md flex h-7 w-7 shrink-0 items-center justify-center rounded-full', i <= step ? 'bg-primary text-on-primary' : 'bg-surface-container-high text-on-surface-variant')}>
                    {i < step ? <Icon name="check" size={16} /> : i + 1}
                  </span>
                  <span className={cx('t-label-md hidden medium:block', i === step ? 'text-on-surface' : 'text-on-surface-variant')}>{s}</span>
                </li>
              ))}
            </ol>

            {step === 0 && (
              <div className="flex flex-col gap-4">
                <p className="t-body-md text-on-surface-variant">Enter the SETUP_TOKEN you saved in your Vercel environment variables. It proves you own this deployment.</p>
                <Field label="Setup token" type="password" value={token} onChange={(e) => setToken(e.target.value)} autoFocus />
                <Button className="h-14" onClick={verify} disabled={busy || !token}>{busy ? 'Checking…' : 'Check connection'}</Button>
              </div>
            )}

            {step === 1 && (
              <div className="flex flex-col gap-4">
                <p className="t-body-md text-on-surface-variant">This creates the tables and security rules in your Supabase database. It is safe to run again.</p>
                <Button className="h-14" onClick={migrate} disabled={busy}>{busy ? 'Setting up…' : 'Run migrations'}</Button>
              </div>
            )}

            {step === 2 && (
              <div className="flex flex-col gap-4">
                <p className="t-body-md text-on-surface-variant">Create the owner account. Public sign-up stays off, so this is the only account.</p>
                <Field label="Email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
                <Field label="Username" value={username} onChange={(e) => setUsername(e.target.value)} autoCapitalize="none" hint="3-30 characters: letters, numbers, dot, dash, underscore" />
                <Field label="Password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" hint="At least 10 characters" />
                <div className="flex items-center justify-between gap-4">
                  <span className="t-body-md">Preload starter lists (categories, banks, payment modes). You can edit them later.</span>
                  <Switch checked={seed} onChange={setSeed} label="Preload starter lists" />
                </div>
                <Button className="h-14" onClick={createOwner} disabled={busy || !email || username.length < 3 || password.length < 10}>{busy ? 'Creating…' : 'Create account and lock setup'}</Button>
              </div>
            )}

            {step === 3 && (
              <div className="flex flex-col gap-4">
                <span className="flex h-12 w-12 items-center justify-center rounded-full bg-income-container text-on-income-container"><Icon name="check" /></span>
                <p className="t-body-lg">All set. Setup is now locked for good.</p>
                <p className="t-body-md text-on-surface-variant">Sign in, then open Settings to add optional extras: email (SMTP) for password resets, and the Google Sheet sync.</p>
                <a href="/login" className="state t-label-lg inline-flex h-14 items-center justify-center rounded-full bg-primary px-6 text-on-primary">Go to sign in</a>
              </div>
            )}

            {msg && (
              <p role="alert" className={cx('t-body-md mt-4 flex items-start gap-2 rounded-m3-md px-3 py-2', msg.ok ? 'bg-income-container text-on-income-container' : 'bg-error-container text-on-error-container')}>
                <Icon name={msg.ok ? 'check_circle' : 'error'} size={20} />
                {msg.text}
              </p>
            )}
          </>
        )}
      </div>
    </main>
  );
}
