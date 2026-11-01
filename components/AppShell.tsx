'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';
import { Icon, cx } from '@/components/ui';
import { useApp } from '@/components/AppProvider';
import { pendingCount } from '@/lib/offline';

const TABS = [
  { href: '/expense', label: 'Expense', icon: 'payments' },
  { href: '/income', label: 'Income', icon: 'savings' },
  { href: '/insights', label: 'Insights', icon: 'monitoring' },
  { href: '/settings', label: 'Settings', icon: 'settings' },
];

export function usePending() {
  const [n, setN] = useState(0);
  useEffect(() => {
    const f = () => pendingCount().then(setN).catch(() => {});
    f();
    window.addEventListener('et-queue', f);
    return () => window.removeEventListener('et-queue', f);
  }, []);
  return n;
}

/* Material 3 Expressive navigation:
 *  - phones (< 840px): 64dp navigation bar, 56x32 pill indicator, icon over label, labels always shown
 *  - tablets / small laptops (840–1199px): 96dp navigation rail, same pill indicator
 *  - desktop (>= 1200px): expanded rail, icon and label in a row inside a full-width pill */
export function AppShell({ children }: { children: ReactNode }) {
  const path = usePathname();
  const pending = usePending();
  const { username, email } = useApp();
  const [online, setOnline] = useState(true);
  useEffect(() => {
    const f = () => setOnline(navigator.onLine);
    f();
    window.addEventListener('online', f);
    window.addEventListener('offline', f);
    return () => {
      window.removeEventListener('online', f);
      window.removeEventListener('offline', f);
    };
  }, []);

  const active = (href: string) => path === href || (href === '/expense' && path === '/trash') || path.startsWith(href + '/');
  const who = username || email.split('@')[0] || 'You';

  return (
    <div className="min-h-dvh">
      {/* ------------------------------------------------------------ rail (tablet + desktop) */}
      <nav aria-label="Main" className="fixed inset-y-0 left-0 z-30 hidden w-24 flex-col items-stretch bg-surface px-3 pb-6 pt-8 expanded:flex large:w-72 large:px-4">
        <div className="mb-8 flex items-center gap-3 px-1 large:px-3">
          <span className="mx-auto flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-primary-container text-on-primary-container large:mx-0">
            <Icon name="account_balance_wallet" size={26} fill />
          </span>
          <span className="t-title-lg hidden large:block">Expenses</span>
        </div>

        <div className="flex flex-col gap-3 large:gap-1">
          {TABS.map((t) => {
            const on = active(t.href);
            return (
              <Link
                key={t.href}
                href={t.href}
                aria-current={on ? 'page' : undefined}
                className={cx(
                  'group relative flex flex-col items-center gap-1 rounded-2xl pb-1 pt-1 large:h-14 large:flex-row large:gap-3 large:rounded-full large:px-4 large:py-0',
                  on ? 'text-on-secondary-container' : 'text-on-surface-variant',
                )}
              >
                <span
                  aria-hidden
                  className={cx(
                    'absolute left-1/2 top-1 -ml-7 h-8 w-14 rounded-full bg-secondary-container transition-[transform,opacity] duration-300 ease-emphasized',
                    'large:left-0 large:top-0 large:ml-0 large:h-full large:w-full',
                    on ? 'scale-x-100 opacity-100' : 'scale-x-50 opacity-0',
                  )}
                />
                <span aria-hidden className="absolute left-1/2 top-1 -ml-7 h-8 w-14 rounded-full bg-on-surface opacity-0 transition-opacity duration-150 group-hover:opacity-[0.08] large:left-0 large:top-0 large:ml-0 large:h-full large:w-full" />
                <span className="relative flex h-8 w-14 items-center justify-center large:w-auto">
                  <Icon name={t.icon} fill={on} />
                </span>
                <span className={cx('relative t-label-md large:t-label-lg', on ? 'font-semibold' : 'font-medium')}>{t.label}</span>
              </Link>
            );
          })}
        </div>

        <div className="mt-auto hidden items-center gap-3 rounded-full bg-surface-container-low py-2 pl-2 pr-4 large:flex">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-tertiary-container t-title-md uppercase text-on-tertiary-container">{who.slice(0, 1)}</span>
          <span className="min-w-0">
            <span className="t-label-lg block truncate">{who}</span>
            <span className="t-label-md block truncate font-normal text-on-surface-variant">{email}</span>
          </span>
        </div>
      </nav>

      {/* ------------------------------------------------------------ content */}
      <main className="min-w-0 pb-[calc(var(--nav-h)+env(safe-area-inset-bottom))] expanded:pb-0 expanded:pl-24 large:pl-72">
        {(!online || pending > 0) && (
          <div className="t-label-md mx-4 mt-3 flex items-center justify-center gap-2 rounded-full bg-tertiary-container py-2 text-on-tertiary-container expanded:mx-6" role="status">
            <Icon name={online ? 'sync' : 'cloud_off'} size={16} className={online ? 'spin' : ''} />
            {online ? `Syncing ${pending} pending ${pending === 1 ? 'entry' : 'entries'}` : `Offline${pending ? ` · ${pending} pending` : ''}`}
          </div>
        )}
        {children}
      </main>

      {/* ------------------------------------------------------------ bottom navigation (phones) */}
      <nav
        aria-label="Main"
        className="fixed inset-x-0 bottom-0 z-30 bg-surface-container pb-[env(safe-area-inset-bottom)] expanded:hidden"
      >
        <div className="mx-auto flex h-16 max-w-[560px] items-stretch px-2">
          {TABS.map((t) => {
            const on = active(t.href);
            return (
              <Link
                key={t.href}
                href={t.href}
                aria-current={on ? 'page' : undefined}
                className="group relative flex flex-1 flex-col items-center justify-center gap-1 pt-0.5"
              >
                <span className="relative flex h-8 w-16 items-center justify-center">
                  <span
                    aria-hidden
                    className={cx(
                      'absolute inset-0 rounded-full bg-secondary-container transition-[transform,opacity] duration-300 ease-emphasized',
                      on ? 'scale-x-100 opacity-100' : 'scale-x-50 opacity-0',
                    )}
                  />
                  <span aria-hidden className="absolute inset-0 rounded-full bg-on-surface opacity-0 transition-opacity duration-100 group-active:opacity-[0.12]" />
                  <Icon
                    name={t.icon}
                    fill={on}
                    className={cx('relative transition-colors duration-200', on ? 'text-on-secondary-container' : 'text-on-surface-variant')}
                  />
                </span>
                <span className={cx('t-label-md transition-colors duration-200', on ? 'font-semibold text-on-surface' : 'font-medium text-on-surface-variant')}>{t.label}</span>
              </Link>
            );
          })}
        </div>
      </nav>
    </div>
  );
}
