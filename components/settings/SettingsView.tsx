'use client';
import { useEffect, useState } from 'react';
import { Button, Card, Field, Icon, Section, Segmented, Switch, cx, useSnackbar } from '@/components/ui';
import { useApp } from '@/components/AppProvider';
import { ListsSection } from '@/components/settings/Lists';
import { TemplatesSection } from '@/components/settings/Templates';
import { PalettePicker } from '@/components/settings/PalettePicker';
import { supabaseBrowser } from '@/lib/supabase/browser';
import { formatDate } from '@/lib/format';
import type { RememberLast } from '@/lib/types';

async function api(path: string, method: string, body?: unknown) {
  const res = await fetch(path, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  const json = (await res.json().catch(() => ({}))) as Record<string, any>;
  return { ok: res.ok, ...json } as { ok: boolean; error?: string; [k: string]: any };
}

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
      <GoogleSheet />
      <Email />
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

/* ------------------------------------------------------------- Google Sheet */
function GoogleSheet() {
  const { settings, refreshSettings } = useApp();
  const snack = useSnackbar();
  const [saEmail, setSaEmail] = useState<string | null>(null);
  const [configured, setConfigured] = useState(false);
  const [json, setJson] = useState('');
  const [url, setUrl] = useState(settings.sheet?.url ?? '');
  const [tab, setTab] = useState(settings.sheet?.tab ?? 'Expenses');
  const [busy, setBusy] = useState('');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const loadKey = async () => {
    const r = await api('/api/settings/google', 'GET');
    setConfigured(!!r.configured);
    setSaEmail(r.email ?? null);
  };
  useEffect(() => { loadKey(); }, []);
  useEffect(() => {
    const f = () => refreshSettings();
    window.addEventListener('et-sheet-sync', f);
    return () => window.removeEventListener('et-sheet-sync', f);
  }, [refreshSettings]);

  const saveKey = async () => {
    setBusy('key');
    const r = await api('/api/settings/google', 'PUT', { json });
    setBusy('');
    if (!r.ok) return setMsg({ ok: false, text: r.error ?? 'Could not save the key' });
    setJson('');
    setMsg({ ok: true, text: 'Key saved (encrypted).' });
    loadKey();
  };
  const connect = async () => {
    setBusy('connect'); setMsg(null);
    const r = await api('/api/sheet', 'PUT', { url, tab });
    setBusy('');
    if (!r.ok) return setMsg({ ok: false, text: r.error ?? 'Connection failed' });
    setMsg({ ok: true, text: 'Connected. Header row checked.' });
    refreshSettings();
  };
  const sync = async (mode: 'now' | 'full') => {
    setBusy(mode); setMsg(null);
    const r = await api('/api/sheet', 'POST', { mode });
    setBusy('');
    if (!r.ok) setMsg({ ok: false, text: r.error ?? 'Sync failed' });
    else setMsg({ ok: true, text: mode === 'full' ? `Rewrote ${r.total ?? 0} rows.` : `Synced ${r.synced ?? 0} change(s)${r.failed ? `, ${r.failed} failed` : ''}.` });
    refreshSettings();
  };
  const disconnect = async () => { await api('/api/sheet', 'DELETE'); refreshSettings(); setMsg(null); };
  const removeKey = async () => { await api('/api/settings/google', 'DELETE'); loadKey(); };

  const s = settings.sheet;
  return (
    <Section title="Google Sheet" icon="table_chart" description="Optional one-way copy of every entry into a sheet. Edits in the sheet are not read back.">
      <ol className="t-body-md mb-3 list-decimal pl-5 text-on-surface-variant">
        <li>Create a service account in Google Cloud and download its JSON key (see SETUP.md).</li>
        <li>Paste the key below. It is stored encrypted and never shown again.</li>
        <li>Share your sheet with the service account email as Editor.</li>
        <li>Paste the sheet link and tab name, then Connect.</li>
      </ol>

      {configured ? (
        <div className="mb-3 flex items-center justify-between gap-2 rounded-2xl bg-secondary-container px-4 py-3 text-on-secondary-container">
          <div className="min-w-0"><div className="t-label-md">Service account</div><div className="t-body-md break-all">{saEmail ?? 'Key saved'}</div></div>
          <Button variant="text" onClick={removeKey}>Remove</Button>
        </div>
      ) : (
        <div className="mb-3">
          <label className="t-label-md mb-1 block text-on-surface-variant" htmlFor="sa-json">Service account JSON key</label>
          <textarea id="sa-json" value={json} onChange={(e) => setJson(e.target.value)} rows={4} spellCheck={false} placeholder='{"type": "service_account", ...}' className="t-body-md w-full rounded-2xl border-2 border-transparent bg-surface-container-high p-3 font-mono transition-colors focus:border-primary focus:outline-none" />
          <Button className="mt-2" variant="tonal" onClick={saveKey} disabled={!json.trim() || busy === 'key'}>Save key</Button>
        </div>
      )}

      <Field label="Sheet link" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://docs.google.com/spreadsheets/d/…" />
      <Field className="mt-3" label="Tab name" value={tab} onChange={(e) => setTab(e.target.value)} />
      <div className="mt-3 flex flex-wrap gap-2">
        <Button onClick={connect} disabled={!configured || !url || !tab || busy === 'connect'} icon="link">{s ? 'Test and save' : 'Connect'}</Button>
        {s && <Button variant="outlined" onClick={() => sync('now')} disabled={!!busy} icon="sync">Sync now</Button>}
        {s && <Button variant="outlined" onClick={() => sync('full')} disabled={!!busy} icon="restart_alt">Full resync</Button>}
        {s && <Button variant="text" onClick={disconnect}>Disconnect</Button>}
      </div>
      {s && (
        <p className="t-body-md mt-3 text-on-surface-variant">
          {s.lastError ? <span className="text-error">Last error: {s.lastError}</span> : s.lastSyncAt ? `Last sync ${new Date(s.lastSyncAt).toLocaleString()}` : 'Connected. Waiting for the first sync.'}
          {url && s.spreadsheetId && <> · Changing the link? Run a full resync afterwards.</>}
        </p>
      )}
      {msg && <Banner {...msg} />}
    </Section>
  );
}

function Banner({ ok, text }: { ok: boolean; text: string }) {
  return (
    <p role="status" className={cx('t-body-md mt-3 flex items-start gap-2 rounded-2xl px-3 py-2', ok ? 'bg-income-container text-on-income-container' : 'bg-error-container text-on-error-container')}>
      <Icon name={ok ? 'check_circle' : 'error'} size={20} />{text}
    </p>
  );
}

/* ------------------------------------------------------------- SMTP */
function Email() {
  const { email } = useApp();
  const [f, setF] = useState({ host: '', port: '587', secure: false, user: '', pass: '', from: '' });
  const [hasPass, setHasPass] = useState(false);
  const [busy, setBusy] = useState('');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  useEffect(() => {
    api('/api/settings/smtp', 'GET').then((r) => {
      if (r.smtp) { setF({ host: r.smtp.host, port: String(r.smtp.port), secure: r.smtp.secure, user: r.smtp.user, pass: '', from: r.smtp.from }); setHasPass(r.smtp.hasPassword); }
    });
  }, []);
  const save = async () => {
    setBusy('save'); setMsg(null);
    const r = await api('/api/settings/smtp', 'PUT', { ...f, port: Number(f.port), pass: f.pass || undefined });
    setBusy('');
    if (!r.ok) return setMsg({ ok: false, text: r.error ?? 'Could not save' });
    setHasPass(hasPass || !!f.pass); setF({ ...f, pass: '' });
    setMsg({ ok: true, text: 'Saved (password encrypted).' });
  };
  const test = async () => {
    setBusy('test'); setMsg(null);
    const r = await api('/api/settings/smtp', 'POST', {});
    setBusy('');
    setMsg(r.ok ? { ok: true, text: `Test email sent to ${r.to}.` } : { ok: false, text: r.error ?? 'Failed' });
  };
  const set = (k: keyof typeof f, v: string | boolean) => setF((s) => ({ ...s, [k]: v }));
  return (
    <Section title="Email (SMTP)" icon="mail" description={`Used for password reset emails. The test goes to ${email}. Password sign-in keeps working even if this is wrong.`}>
      <div className="grid gap-3 medium:grid-cols-2">
        <Field label="Host" value={f.host} onChange={(e) => set('host', e.target.value)} placeholder="smtp-relay.brevo.com" />
        <Field label="Port" inputMode="numeric" value={f.port} onChange={(e) => set('port', e.target.value.replace(/\D/g, ''))} />
        <Field label="Username" value={f.user} onChange={(e) => set('user', e.target.value)} autoComplete="off" />
        <Field label="Password" type="password" value={f.pass} onChange={(e) => set('pass', e.target.value)} placeholder={hasPass ? '•••••••• (saved)' : ''} autoComplete="new-password" />
        <Field className="medium:col-span-2" label="From address" value={f.from} onChange={(e) => set('from', e.target.value)} placeholder='Expense tracker <you@example.com>' />
      </div>
      <Row label="Implicit TLS" hint="On for port 465. Off for 587 (STARTTLS)."><Switch label="Implicit TLS" checked={f.secure} onChange={(v) => set('secure', v)} /></Row>
      <div className="mt-2 flex gap-2">
        <Button onClick={save} disabled={!f.host || !f.port || !f.from || busy === 'save'}>Save</Button>
        <Button variant="outlined" onClick={test} disabled={!hasPass && !f.pass ? false : busy === 'test'} icon="send">Send test email</Button>
      </div>
      {msg && <Banner {...msg} />}
    </Section>
  );
}

/* ------------------------------------------------------------- account & data */
function Account() {
  const { username, email } = useApp();
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const changePw = async () => {
    if (pw !== pw2) return setMsg({ ok: false, text: 'Passwords do not match.' });
    const r = await api('/api/auth/reset', 'POST', { password: pw });
    setMsg(r.ok ? { ok: true, text: 'Password changed.' } : { ok: false, text: r.error ?? 'Failed' });
    if (r.ok) { setPw(''); setPw2(''); }
  };
  const out = async (scope: 'local' | 'others') => {
    await api('/api/auth/logout', 'POST', { scope });
    if (scope === 'local') { await supabaseBrowser().auth.signOut({ scope: 'local' }).catch(() => {}); window.location.href = '/login'; }
    else setMsg({ ok: true, text: 'Signed out of all other devices.' });
  };
  return (
    <>
      <Section title="Data" icon="download" description="Your data stays yours. Export everything any time.">
        <a href="/api/export" className="state press t-label-lg inline-flex h-12 items-center gap-2 rounded-full border border-outline-variant px-6 text-primary"><Icon name="download" size={18} />Export all as CSV</a>
      </Section>
      <Section title="Account" icon="person" description={`${username ? `@${username} · ` : ''}${email}`}>
        <div className="grid gap-3 medium:grid-cols-2">
          <Field label="New password" type="password" value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="new-password" hint="At least 10 characters" />
          <Field label="Confirm" type="password" value={pw2} onChange={(e) => setPw2(e.target.value)} autoComplete="new-password" />
        </div>
        <Button className="mt-3" variant="tonal" disabled={pw.length < 10} onClick={changePw}>Change password</Button>
        {msg && <Banner {...msg} />}
        <div className="mt-6 flex flex-wrap gap-2 border-t border-outline-variant/40 pt-4">
          <Button variant="outlined" onClick={() => out('others')}>Sign out other devices</Button>
          <Button variant="outlined" className="!text-error" icon="logout" onClick={() => out('local')}>Sign out</Button>
        </div>
      </Section>
    </>
  );
}
