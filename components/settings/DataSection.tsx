'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Button, Field, Icon, Section, Segmented, Sheet, Switch, cx, useSnackbar } from '@/components/ui';
import { useApp } from '@/components/AppProvider';
import { useSession } from '@/components/auth/SessionProvider';
import { applyImport, planImport, type DateOrder, type ImportPlan } from '@/core/csv';
import { MIN_PASSWORD_LENGTH, collectData, createBackup, openBackup, restoreData, type BackupData, type BackupHeader } from '@/core/backup';
import { getDb } from '@/lib/local/runtime';
import { exportRange } from '@/lib/local/files';
import { pickFile, readBytes, readText, saveAndShare } from '@/lib/local/platform';
import { requestSync } from '@/lib/local/sync';
import { applyPalette } from '@/components/AppProvider';

const KIND_LABEL: Record<string, string> = { category: 'Categories', income_source: 'Income sources', bank: 'Banks', payment_mode: 'Payment modes' };

export function DataSection() {
  const snack = useSnackbar();
  const [busy, setBusy] = useState('');
  const exportAll = async () => {
    setBusy('export');
    try { await exportRange(); } catch (e) { snack({ message: (e as Error).message || 'Could not export' }); }
    setBusy('');
  };
  return (
    <Section title="Data" icon="database" description="Your data stays on this phone. Take a backup to move it to another phone, or use CSV to move it in and out of other apps.">
      <div className="flex flex-col gap-3">
        <BackupButton />
        <RestoreButton />
        <ImportButton />
        <Button variant="outlined" icon="download" onClick={exportAll} disabled={busy === 'export'} data-testid="export-csv">Export all as CSV</Button>
      </div>
    </Section>
  );
}

function Err({ text }: { text: string }) {
  return <p role="alert" className="t-body-md mt-3 flex items-start gap-2 rounded-2xl bg-error-container px-3 py-2 text-on-error-container"><Icon name="error" size={20} />{text}</p>;
}

/* ------------------------------------------------------------------ backup */
function BackupButton() {
  const { username } = useApp();
  const snack = useSnackbar();
  const [open, setOpen] = useState(false);
  const [pw, setPw] = useState('');
  const [again, setAgain] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const close = () => { setOpen(false); setPw(''); setAgain(''); setError(''); };
  const make = async () => {
    if (pw !== again) return setError('Passwords do not match.');
    setBusy(true); setError('');
    try {
      const data = await collectData(getDb(), { username });
      const file = await createBackup(data, pw);
      await saveAndShare({ filename: `daily-expenses-backup-${new Date().toISOString().slice(0, 10)}.zip`, data: file, dialogTitle: 'Save your backup' });
      snack({ message: 'Backup created. Keep the file and its password somewhere safe.' });
      close();
    } catch (e) { setError((e as Error).message || 'Could not create the backup.'); }
    setBusy(false);
  };
  return (
    <>
      <Button variant="tonal" icon="backup" onClick={() => setOpen(true)} data-testid="backup-open">Back up to a file</Button>
      <Sheet open={open} onClose={close} title="Back up" footer={<Button className="h-14 w-full" onClick={make} disabled={busy || pw.length < MIN_PASSWORD_LENGTH || !again} data-testid="backup-create">{busy ? 'Encrypting…' : 'Create backup'}</Button>}>
        <p className="t-body-lg text-on-surface-variant">Creates a zip file with all your entries, lists, templates, settings and your Google service account key. It is encrypted with the password below, so only you can open it.</p>
        <div className="mt-4 flex flex-col gap-3">
          <Field label="Backup password" type="password" value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="new-password" hint={`At least ${MIN_PASSWORD_LENGTH} characters. Different from your app password is fine.`} data-testid="backup-password" />
          <Field label="Confirm backup password" type="password" value={again} onChange={(e) => setAgain(e.target.value)} autoComplete="new-password" data-testid="backup-confirm" />
        </div>
        <p className="t-body-md mt-3 rounded-2xl bg-error-container px-3 py-2 text-on-error-container">If you forget this password the backup cannot be opened. Nobody can recover it.</p>
        {error && <Err text={error} />}
      </Sheet>
    </>
  );
}

/* ------------------------------------------------------------------ restore into this account */
function RestoreButton() {
  const { refreshOptions, refreshTemplates, refreshSettings } = useApp();
  const snack = useSnackbar();
  const [open, setOpen] = useState(false);
  const [file, setFile] = useState<{ name: string; bytes: Uint8Array } | null>(null);
  const [pw, setPw] = useState('');
  const [opened, setOpened] = useState<{ header: BackupHeader; data: BackupData } | null>(null);
  const [mode, setMode] = useState<'merge' | 'replace'>('merge');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const close = () => { setOpen(false); setFile(null); setPw(''); setOpened(null); setError(''); setMode('merge'); };

  const choose = async () => {
    setError('');
    try { const f = await pickFile('.zip,application/zip,application/octet-stream'); if (f) { setFile({ name: f.name, bytes: await readBytes(f) }); setOpened(null); } }
    catch (e) { setError((e as Error).message); }
  };
  const unlock = async () => {
    setBusy(true); setError('');
    try { setOpened(await openBackup(file!.bytes, pw)); } catch (e) { setError((e as Error).message); }
    setBusy(false);
  };
  const run = async () => {
    setBusy(true); setError('');
    try {
      const r = await restoreData(getDb(), opened!.data, mode);
      await Promise.all([refreshOptions(), refreshTemplates(), refreshSettings()]);
      const { data } = await (await import('@/lib/local/client')).localDb().from('user_settings').select('accent_hex').maybeSingle();
      if (data?.accent_hex) await applyPalette(data.accent_hex as string);
      requestSync('manual');
      snack({ message: mode === 'replace' ? `Restored ${r.transactionsAdded} entries.` : `Added ${r.transactionsAdded} entries (${r.transactionsSkipped} already here).` });
      close();
    } catch (e) { setError((e as Error).message || 'Could not restore.'); }
    setBusy(false);
  };

  return (
    <>
      <Button variant="tonal" icon="restore" onClick={() => setOpen(true)} data-testid="restore-open-settings">Restore from a backup</Button>
      <Sheet open={open} onClose={close} title="Restore" footer={opened ? <Button className="h-14 w-full" onClick={run} disabled={busy} data-testid="restore-run">{busy ? 'Restoring…' : mode === 'replace' ? 'Replace everything' : 'Add to this account'}</Button> : <Button className="h-14 w-full" onClick={unlock} disabled={busy || !file || !pw} data-testid="restore-unlock">{busy ? 'Opening…' : 'Open backup'}</Button>}>
        {!opened ? (
          <div className="flex flex-col gap-3">
            <p className="t-body-lg text-on-surface-variant">Choose a Daily Expenses backup (.zip) and enter its backup password.</p>
            <Button variant="outlined" icon="folder_open" onClick={choose} data-testid="restore-choose-settings">{file ? file.name : 'Choose backup file'}</Button>
            <Field label="Backup password" type="password" value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="off" data-testid="restore-password-settings" />
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            <p className="t-body-lg rounded-2xl bg-secondary-container px-4 py-3 text-on-secondary-container">
              {opened.header.counts.transactions.toLocaleString()} entries, {opened.header.counts.options} list items, {opened.header.counts.templates} templates. Made {new Date(opened.header.createdAt).toLocaleDateString()}.
            </p>
            <Segmented label="How to restore" value={mode} onChange={setMode} options={[{ value: 'merge', label: 'Add missing', icon: 'library_add' }, { value: 'replace', label: 'Replace all', icon: 'swap_horiz' }]} />
            <p className="t-body-md text-on-surface-variant">
              {mode === 'merge' ? 'Keeps what is here and adds entries, lists and templates from the backup that are missing. Your current settings are not changed.' : 'Deletes everything in this account and rebuilds it exactly as in the backup, including settings and the Google service account key.'}
            </p>
          </div>
        )}
        {error && <Err text={error} />}
      </Sheet>
    </>
  );
}

/* ------------------------------------------------------------------ CSV import */
function ImportButton() {
  const { refreshOptions } = useApp();
  const snack = useSnackbar();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [name, setName] = useState('');
  const [kind, setKind] = useState<'auto' | 'expense' | 'income'>('auto');
  const [order, setOrder] = useState<'auto' | DateOrder>('auto');
  const [skipDup, setSkipDup] = useState(true);
  const [plan, setPlan] = useState<ImportPlan | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const seq = useRef(0);

  const close = () => { setOpen(false); setText(''); setName(''); setPlan(null); setError(''); setKind('auto'); setOrder('auto'); setSkipDup(true); };

  const replan = useCallback(async () => {
    if (!text) return;
    const my = ++seq.current;
    setBusy(true); setError('');
    try {
      const p = await planImport(getDb(), text, { kind, defaultKind: 'expense', skipDuplicates: skipDup, dateOrder: order === 'auto' ? undefined : order });
      if (my === seq.current) setPlan(p);
    } catch (e) { if (my === seq.current) { setPlan(null); setError((e as Error).message); } }
    if (my === seq.current) setBusy(false);
  }, [text, kind, order, skipDup]);
  useEffect(() => { void replan(); }, [replan]);

  const choose = async () => {
    setError('');
    try { const f = await pickFile('.csv,.txt,text/csv,text/plain'); if (f) { setName(f.name); setText(await readText(f)); setOpen(true); } }
    catch (e) { setError((e as Error).message); setOpen(true); }
  };
  const run = async () => {
    if (!plan) return;
    setBusy(true); setError('');
    try {
      const r = await applyImport(getDb(), plan);
      await refreshOptions();
      requestSync('change');
      snack({ message: `Imported ${r.inserted} entries${r.createdOptions ? `, created ${r.createdOptions} new list items` : ''}${r.skippedDuplicates ? `, skipped ${r.skippedDuplicates} duplicates` : ''}.` });
      close();
    } catch (e) { setError((e as Error).message || 'Import failed. Nothing was changed.'); }
    setBusy(false);
  };

  const counts = plan ? { exp: plan.rows.filter((r) => r.kind === 'expense').length, inc: plan.rows.filter((r) => r.kind === 'income').length } : null;
  const grouped = (list: ImportPlan['newOptions']) => Object.entries(list.reduce<Record<string, string[]>>((a, o) => { (a[o.kind] ??= []).push(`${o.name} (${o.count})`); return a; }, {}));

  return (
    <>
      <Button variant="tonal" icon="upload_file" onClick={choose} data-testid="import-choose">Import from CSV</Button>
      <Sheet open={open} onClose={close} title="Import CSV" footer={<Button className="h-14 w-full" onClick={run} disabled={busy || !plan || plan.rows.length === 0} data-testid="import-run">{busy ? 'Working…' : plan ? `Import ${plan.rows.length} entries` : 'Import'}</Button>}>
        <p className="t-body-md text-on-surface-variant">{name}</p>
        <div className="mt-3 flex flex-col gap-4">
          <div>
            <div className="t-label-lg mb-2">These rows are</div>
            <Segmented label="Entry type" value={kind} onChange={setKind} options={[{ value: 'auto', label: 'Auto' }, { value: 'expense', label: 'Expenses' }, { value: 'income', label: 'Income' }]} />
          </div>
          <div>
            <div className="t-label-lg mb-2">Dates look like</div>
            <Segmented label="Date order" value={order} onChange={setOrder} options={[{ value: 'auto', label: 'Auto' }, { value: 'dmy', label: 'Day first' }, { value: 'mdy', label: 'Month first' }]} />
          </div>
          <div className="flex items-center justify-between gap-4"><div className="t-body-lg">Skip entries already in the app</div><Switch label="Skip duplicates" checked={skipDup} onChange={setSkipDup} /></div>

          {plan && counts && (
            <div className="rounded-2xl bg-surface-container-low p-4" data-testid="import-preview">
              <div className="t-title-md">{plan.rows.length.toLocaleString()} ready to import</div>
              <div className="t-body-md text-on-surface-variant">{counts.exp} expenses · {counts.inc} income · {plan.duplicates} duplicates {skipDup ? 'skipped' : 'included'} · {plan.errorCount} rows with problems</div>
              {plan.newOptions.length > 0 && (
                <div className="mt-3"><div className="t-label-lg">New items that will be created</div>
                  {grouped(plan.newOptions).map(([k, v]) => <div key={k} className="t-body-md text-on-surface-variant"><b className="font-medium text-on-surface">{KIND_LABEL[k] ?? k}:</b> {v.join(', ')}</div>)}
                </div>
              )}
              {plan.matchedOptions.length > 0 && (
                <div className="mt-3"><div className="t-label-lg">Matched to existing</div>
                  {grouped(plan.matchedOptions).map(([k, v]) => <div key={k} className="t-body-md text-on-surface-variant"><b className="font-medium text-on-surface">{KIND_LABEL[k] ?? k}:</b> {v.join(', ')}</div>)}
                </div>
              )}
              {plan.warnings.map((w) => <p key={w} className="t-body-md mt-2 text-on-surface-variant">{w}</p>)}
              {plan.errors.length > 0 && (
                <details className="mt-3"><summary className="t-label-lg cursor-pointer">Skipped rows ({plan.errorCount})</summary>
                  <ul className="t-body-md mt-1 list-disc pl-5 text-on-surface-variant">{plan.errors.slice(0, 20).map((e) => <li key={e.line}>Line {e.line}: {e.reason}</li>)}</ul>
                </details>
              )}
              <div className={cx('t-body-md mt-3 text-on-surface-variant')}>Nothing is saved until you tap Import. If anything fails, nothing is imported.</div>
            </div>
          )}
        </div>
        {error && <Err text={error} />}
      </Sheet>
    </>
  );
}
