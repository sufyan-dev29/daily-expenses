'use client';
import Link from 'next/link';
import { useState } from 'react';
import { Button, Field, Icon } from '@/components/ui';

export default function ForgotPage() {
  const [identifier, setIdentifier] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    await fetch('/api/auth/forgot', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ identifier }) }).catch(() => {});
    setSent(true);
    setBusy(false);
  };

  if (sent) {
    return (
      <div className="flex flex-col gap-4">
        <span className="flex h-12 w-12 items-center justify-center rounded-full bg-secondary-container text-on-secondary-container"><Icon name="mark_email_read" /></span>
        <h1 className="t-headline">Check your email</h1>
        <p className="t-body-lg text-on-surface-variant">If an account matches, a reset link is on its way. It can take a minute.</p>
        <Link href="/login" className="t-label-lg self-start py-3 text-primary">Back to sign in</Link>
      </div>
    );
  }
  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <h1 className="t-headline">Reset password</h1>
      <p className="t-body-md text-on-surface-variant">Enter your email or username and we will send a reset link.</p>
      <Field label="Email or username" value={identifier} onChange={(e) => setIdentifier(e.target.value)} autoCapitalize="none" autoFocus required />
      <Button type="submit" className="h-14" disabled={busy || !identifier}>{busy ? 'Sending…' : 'Send reset link'}</Button>
      <Link href="/login" className="t-label-lg self-center py-3 text-primary">Back to sign in</Link>
    </form>
  );
}
