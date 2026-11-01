'use client';
import { useEffect, useState } from 'react';
import { Button, Field, Icon, Section, Segmented, cx, useSnackbar } from '@/components/ui';
import { useApp } from '@/components/AppProvider';
import { SheetsClient, explain, parseServiceAccount, parseSpreadsheetId, testConnection, type SheetConfig } from '@/core/sheets';
import { GOOGLE_KEY, NEEDS_FULL_RESYNC, deleteSecret, getSecret, setSecret } from '@/core/secrets';
import { getDb } from '@/lib/local/runtime';
import { localDb } from '@/lib/local/client';
import { applyMode } from '@/lib/local/account';
import { syncNow } from '@/lib/local/sync';
import { pickFile, readText } from '@/lib/local/platform';
import { pendingCount } from '@/lib/offline';

const fetchDep = { fetch: (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string }) => fetch(url, init) as never };

function Banner({ ok, text }: { ok: boolean; text: string }) {
  return (
    <p role="status" className={cx('t-body-md mt-3 flex items-start gap-2 rounded-2xl px-3 py-2', ok ? 'bg-income-container text-on-income-container' : 'bg-error-container text-on-error-container')}>
      <Icon name={ok ? 'check_circle' : 'error'} size={20} />{text}
    </p>
  );
}

export function ModeAndSheet() {
  const { settings, refreshSettings } = useApp();
  const snack = useSnackbar();
  const online = settings.mode === 'online';

  const setMode = async (m: 'offline' | 'online') => {
    await applyMode(m);
    await refreshSettings();
    snack({ message: m === 'online' ? 'Converted to Online. Add your Google service account below.' : 'Switched to Offline. Nothing is sent to Google while offline.' });
  };

  return (
    <>
      <Section title="Mode" icon="cloud_sync" description="Offline keeps everything on this phone. Online also keeps a copy of every entry in a Google Sheet you own, using a Google service account. Entries made without internet are sent automatically the next time the app opens with internet.">
        <Segmented
          label="Account mode"
          value={settings.mode}
          onChange={setMode}
          options={[{ value: 'offline', label: 'Offline', icon: 'cloud_off' }, { value: 'online', label: 'Online', icon: 'cloud_sync' }]}
        />
        {!online && <Button className="mt-3" variant="tonal" icon="cloud_upload" onClick={() => setMode('online')}>Convert to Online account</Button>}
      </Section>
      {online && <SheetSection />}
    </>
  );
}

function SheetSection() {
  const { settings, refreshSettings } = useApp();
  const [saEmail, setSaEmail] = useState<string | null>(null);
  const [configured, setConfigured] = useState(false);
  const [json, setJson] = useState('');
  const [url, setUrl] = useState(settings.sheet?.url ?? '');
  const [tab, setTab] = useState(settings.sheet?.tab ?? 'Expenses');
  const [busy, setBusy] = useState('');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, setPending] = useState(0);

  const loadKey = async () => {
    const raw = await getSecret(getDb(), GOOGLE_KEY);
    setConfigured(!!raw);
    try { setSaEmail(raw ? parseServiceAccount(raw).client_email : null); } catch { setSaEmail(null); }
  };
  useEffect(() => { void loadKey(); }, []);
  useEffect(() => {
    const f = () => { void refreshSettings(); pendingCount().then(setPending).catch(() => {}); };
    f();
    window.addEventListener('et-sheet-sync', f);
    window.addEventListener('et-queue', f);
    return () => { window.removeEventListener('et-sheet-sync', f); window.removeEventListener('et-queue', f); };
  }, [refreshSettings]);

  const storeKey = async (text: string) => {
    setBusy('key'); setMsg(null);
    try {
      const k = parseServiceAccount(text);
      await setSecret(getDb(), GOOGLE_KEY, text);
      setJson('');
      setMsg({ ok: true, text: `Key saved on this phone (${k.client_email}). Share your sheet with that address as Editor.` });
      await loadKey();
    } catch (e) { setMsg({ ok: false, text: (e as Error).message }); }
    setBusy('');
  };
  const chooseFile = async () => {
    const f = await pickFile('.json,application/json');
    if (f) { try { await storeKey(await readText(f)); } catch (e) { setMsg({ ok: false, text: (e as Error).message }); } }
  };
  const connect = async () => {
    setBusy('connect'); setMsg(null);
    const id = parseSpreadsheetId(url);
    if (!id) { setBusy(''); return setMsg({ ok: false, text: 'That does not look like a Google Sheets link.' }); }
    const cfg: SheetConfig = { spreadsheetId: id, tab: tab.trim() || 'Expenses', url: url.trim(), lastSyncAt: null, lastError: null };
    try {
      const raw = await getSecret(getDb(), GOOGLE_KEY);
      if (!raw) throw new Error('Add the service account key first.');
      await testConnection(new SheetsClient(raw, fetchDep), cfg);
      await localDb().from('user_settings').update({ sheet: cfg });
      await setSecret(getDb(), NEEDS_FULL_RESYNC, '1'); // send everything already in the app
      setMsg({ ok: true, text: 'Connected. Copying your entries to the sheet…' });
      await refreshSettings();
      void syncNow();
    } catch (e) { setMsg({ ok: false, text: explain(e) }); }
    setBusy('');
  };
  const sync = async (full: boolean) => {
    setBusy(full ? 'full' : 'now'); setMsg(null);
    const r = await syncNow({ full });
    setBusy('');
    if (!r) setMsg({ ok: false, text: 'Sync failed.' });
    else if (r.offline) setMsg({ ok: true, text: 'No internet right now. Your changes are saved and will be sent automatically.' });
    else if (r.error) setMsg({ ok: false, text: r.error });
    else setMsg({ ok: true, text: r.total !== undefined ? `Rewrote ${r.total} rows.` : `Synced ${r.synced} change(s).` });
    await refreshSettings();
  };
  const disconnect = async () => {
    await localDb().from('user_settings').update({ sheet: null });
    await getDb().run('DELETE FROM sync_outbox');
    await deleteSecret(getDb(), NEEDS_FULL_RESYNC);
    await refreshSettings(); setMsg(null); setUrl('');
  };
  const removeKey = async () => { await deleteSecret(getDb(), GOOGLE_KEY); await loadKey(); };

  const s = settings.sheet;
  return (
    <Section title="Google Sheet" icon="table_chart" description="One-way copy of every entry into your sheet. Edits made in the sheet are not read back.">
      <ol className="t-body-md mb-3 list-decimal pl-5 text-on-surface-variant">
        <li>In Google Cloud, create a service account and download its JSON key.</li>
        <li>Choose the key file here or paste it. It is stored encrypted on this phone only.</li>
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
          <textarea id="sa-json" value={json} onChange={(e) => setJson(e.target.value)} rows={4} spellCheck={false} autoCapitalize="none" placeholder='{"type": "service_account", ...}' className="t-body-md w-full rounded-2xl border-2 border-transparent bg-surface-container-high p-3 font-mono transition-colors focus:border-primary focus:outline-none" data-testid="sa-json" />
          <div className="mt-2 flex gap-2">
            <Button variant="tonal" onClick={() => storeKey(json)} disabled={!json.trim() || busy === 'key'} data-testid="sa-save">Save key</Button>
            <Button variant="outlined" icon="folder_open" onClick={chooseFile}>Choose file</Button>
          </div>
        </div>
      )}

      <Field label="Sheet link" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://docs.google.com/spreadsheets/d/…" autoCapitalize="none" data-testid="sheet-url" />
      <Field className="mt-3" label="Tab name" value={tab} onChange={(e) => setTab(e.target.value)} data-testid="sheet-tab" />
      <div className="mt-3 flex flex-wrap gap-2">
        <Button onClick={connect} disabled={!configured || !url || !tab || busy === 'connect'} icon="link" data-testid="sheet-connect">{s ? 'Test and save' : 'Connect'}</Button>
        {s && <Button variant="outlined" onClick={() => sync(false)} disabled={!!busy} icon="sync">Sync now</Button>}
        {s && <Button variant="outlined" onClick={() => sync(true)} disabled={!!busy} icon="restart_alt">Full resync</Button>}
        {s && <Button variant="text" onClick={disconnect}>Disconnect</Button>}
      </div>
      {s && (
        <p className="t-body-md mt-3 text-on-surface-variant">
          {s.lastError ? <span className="text-error">Last error: {s.lastError}</span> : s.lastSyncAt ? `Last sync ${new Date(s.lastSyncAt).toLocaleString()}` : 'Connected. Waiting for the first sync.'}
          {pending > 0 && <> · {pending} waiting to be sent</>}
        </p>
      )}
      {msg && <Banner {...msg} />}
    </Section>
  );
}
