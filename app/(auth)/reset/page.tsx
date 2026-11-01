'use client';
import Link from 'next/link';
import { useState } from 'react';
import { Button, Field } from '@/components/ui';

export default function ResetPage() {
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password !== confirm) return setError('Passwords do not match.');
    setBusy(true);
    setError('');
    const res = await fetch('/api/auth/reset', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password }) });
    if (res.ok) {
      window.location.href = '/expense';
      return;
    }
    setError(res.status === 401 ? 'This reset link has expired. Request a new one.' : ((await res.json().catch(() => ({}))) as { error?: string }).error ?? 'Could not update the password.');
    setBusy(false);
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <h1 className="t-headline">Choose a new password</h1>
      <Field label="New password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" hint="At least 10 characters" autoFocus required />
      <Field label="Confirm password" type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" error={error || undefined} required />
      <Button type="submit" className="h-14" disabled={busy || password.length < 10}>{busy ? 'Saving…' : 'Save password'}</Button>
      <Link href="/forgot" className="t-label-lg self-center py-3 text-primary">Request a new link</Link>
    </form>
  );
}
