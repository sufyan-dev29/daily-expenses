'use client';
import { useEffect, useState } from 'react';
import { Button, Card, Field, Icon, Section, Segmented, Switch, cx, useSnackbar } from '@/components/ui';
import { useApp } from '@/components/AppProvider';
import { ListsSection } from '@/components/settings/Lists';
import { TemplatesSection } from '@/components/settings/Templates';
import { PalettePicker } from '@/components/settings/PalettePicker';
import { localDb } from '@/lib/local/client';
import { formatDate } from '@/lib/format';
import { ModeAndSheet } from '@/components/settings/GoogleSheet';
import { DataSection } from '@/components/settings/DataSection';
import { SecuritySection } from '@/components/settings/SecuritySection';
import { useSession } from '@/components/auth/SessionProvider';
import type { RememberLast } from '@/lib/types';

function Row({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="flex min-h-[56px] items-center justify-between gap-4 py-1">
      <div className="min-w-0"><div className="t-body-lg">{label}</div>{hint && <div className="t-body-md text-on-surface-variant">{hint}</div>}</div>
      {children}
    </div>
  );
}

export function SettingsView() {
  return (
    <div className="mx-auto w-full max-w-[760px] px-4 pb-16 expanded:px-8">
      <header className="flex h-20 items-center"><h1 className="t-headline">Settings</h1></header>
      <Appearance />
      <ListsSection />
      <TemplatesSection />
      <Formats />
      <Behaviour />
      <ModeAndSheet />
      <DataSection />
      <SecuritySection />
      <Account />
    </div>
  );
}

/* ------------------------------------------------------------- appearance */
function Appearance() {
  const { settings, setSettings } = useApp();
  const snack = useSnackbar();
  const save = async (patch: Parameters<typeof setSettings>[0]) => { const e = await setSettings(patch); if (e) snack({ message: e }); };
  return (
    <Section title="Appearance" icon="palette" description="Pick a palette and every colour in the app follows. It changes instantly, no reload.">
      <Segmented
        label="Theme"
        value={settings.theme_mode}
        onChange={(v) => save({ theme_mode: v })}
        options={[{ value: 'system', label: 'System', icon: 'brightness_auto' }, { value: 'light', label: 'Light', icon: 'light_mode' }, { value: 'dark', label: 'Dark', icon: 'dark_mode' }]}
      />
      <div className="mt-6"><PalettePicker /></div>
    </Section>
  );
}

/* ------------------------------------------------------------- formats */
function Formats() {
  const { settings, setSettings } = useApp();
  const snack = useSnackbar();
  const [tzs, setTzs] = useState<string[]>([settings.timezone]);
  useEffect(() => {
    try { setTzs((Intl as any).supportedValuesOf('timeZone')); } catch {}
  }, []);
  const save = async (patch: Parameters<typeof setSettings>[0]) => { const e = await setSettings(patch); if (e) snack({ message: e }); };
  const sel = 't-body-lg h-12 rounded-2xl border-2 border-transparent bg-surface-container-high px-3 transition-colors focus:border-primary focus:outline-none';
  return (
    <Section title="Formats" icon="tune" description="Currency is only a label; there is no conversion.">
      <Row label="Currency"><select aria-label="Currency" className={sel} value={settings.currency} onChange={(e) => save({ currency: e.target.value })}>{['PKR', 'USD', 'EUR', 'GBP', 'AED', 'SAR', 'INR'].map((c) => <option key={c}>{c}</option>)}</select></Row>
      <Row label="Date format" hint={formatDate('2026-09-10', settings.date_format, new Date('2026-09-10'))}>
        <select aria-label="Date format" className={sel} value={settings.date_format} onChange={(e) => save({ date_format: e.target.value })}>
          <option value="EEE, d MMM">Thu, 10 Sep</option><option value="d MMM">10 Sep</option><option value="dd/MM">10/09</option><option value="MMM d">Sep 10</option>
        </select>
      </Row>
      <Row label="Week starts on" hint="Used by Insights weeks"><select aria-label="Week start" className={sel} value={settings.week_start} onChange={(e) => save({ week_start: Number(e.target.value) })}><option value={1}>Monday</option><option value={6}>Saturday</option><option value={7}>Sunday</option></select></Row>
      <Row label="Time zone" hint="Decides what “today” means"><select aria-label="Time zone" className={cx(sel, 'max-w-[220px]')} value={settings.timezone} onChange={(e) => save({ timezone: e.target.value })}>{tzs.map((t) => <option key={t}>{t}</option>)}</select></Row>
    </Section>
  );
}

/* ------------------------------------------------------------- behaviour */
function Behaviour() {
  const { settings, setSettings } = useApp();
  const snack = useSnackbar();
  const save = async (patch: Parameters<typeof setSettings>[0]) => { const e = await setSettings(patch); if (e) snack({ message: e }); };
  const toggles: { k: keyof RememberLast; label: string }[] = [
    { k: 'category', label: 'Category' }, { k: 'bank', label: 'Bank' }, { k: 'payment_mode', label: 'Payment mode' }, { k: 'need_want', label: 'Need / want' }, { k: 'income_source', label: 'Income source' },
  ];
  return (
    <Section title="Behaviour" icon="toggle_on" description="New entries start with the values from your most recent entry of the same kind.">
      {toggles.map((t) => (
        <Row key={t.k} label={`Remember ${t.label.toLowerCase()}`}>
          <Switch label={`Remember ${t.label}`} checked={settings.remember_last[t.k]} onChange={(v) => save({ remember_last: { ...settings.remember_last, [t.k]: v } })} />
        </Row>
      ))}
      <Row label="Keep Trash for" hint="Then deleted for good">
        <select aria-label="Trash retention" className="t-body-lg h-12 rounded-2xl border-2 border-transparent bg-surface-container-high px-3 transition-colors focus:border-primary focus:outline-none" value={settings.trash_retention_days} onChange={(e) => save({ trash_retention_days: Number(e.target.value) })}>
          {[7, 14, 30, 60, 90].map((d) => <option key={d} value={d}>{d} days</option>)}
        </select>
      </Row>
    </Section>
  );
}

/* ------------------------------------------------------------- account */
function Account() {
  const { username } = useApp();
  const session = useSession();
  return (
    <Section title="Account" icon="person" description={`${username ? `@${username} · ` : ''}stored only on this phone`}>
      <div className="flex flex-wrap gap-2">
        <Button variant="outlined" className="!text-error" icon="logout" onClick={() => void session.signOut()} data-testid="sign-out">Sign out</Button>
        <Button variant="text" className="!text-error" icon="delete_forever" onClick={() => window.dispatchEvent(new Event('et-delete-account'))} data-testid="delete-open">Delete account</Button>
      </div>
      <p className="t-body-md mt-4 text-on-surface-variant">Daily Expenses · version 1.0.0. No ads, no tracking, no account on any server.</p>
    </Section>
  );
}
