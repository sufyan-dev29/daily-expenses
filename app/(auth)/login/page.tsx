'use client';
import Link from 'next/link';
import { Suspense, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { Button, Field } from '@/components/ui';

function LoginForm() {
  const sp = useSearchParams();
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(sp.get('error') === 'link' ? 'That reset link is invalid or has expired.' : '');
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    const res = await fetch('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ identifier, password }) });
    if (res.ok) {
      window.location.href = '/expense';
      return;
    }
    setError(((await res.json().catch(() => ({}))) as { error?: string }).error ?? 'Incorrect login details.');
    setBusy(false);
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <h1 className="t-headline">Sign in</h1>
      <Field label="Email or username" value={identifier} onChange={(e) => setIdentifier(e.target.value)} autoComplete="username" autoCapitalize="none" autoFocus required />
      <Field label="Password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required error={error || undefined} />
      <Button type="submit" className="h-14" disabled={busy || !identifier || !password}>{busy ? 'Signing in…' : 'Sign in'}</Button>
      <Link href="/forgot" className="t-label-lg self-center py-3 text-primary">Forgot password?</Link>
    </form>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
