'use client';
import { runSync, type SyncOutcome } from '@/core/sheets';
import { getDb, hasSession } from '@/lib/local/runtime';
import { onAppActive, onNetworkUp } from '@/lib/local/platform';

export type SyncReason = 'change' | 'open' | 'resume' | 'network' | 'manual' | 'timer';

const deps = { fetch: (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string }) => fetch(url, init) as unknown as ReturnType<NonNullable<Parameters<typeof runSync>[1]['fetch']>> };

let timer: ReturnType<typeof setTimeout> | undefined;

export async function syncNow(opts: { full?: boolean } = {}): Promise<SyncOutcome | null> {
  if (!hasSession()) return null;
  try {
    const r = await runSync(getDb(), deps, opts);
    window.dispatchEvent(new Event('et-queue'));
    window.dispatchEvent(new Event('et-sheet-sync'));
    return r;
  } catch {
    return null;
  }
}

/** Debounced for edits (a burst of changes is one sync); immediate for open/resume/network. */
export function requestSync(reason: SyncReason): void {
  if (!hasSession()) return;
  window.dispatchEvent(new Event('et-queue'));
  clearTimeout(timer);
  timer = setTimeout(() => { void syncNow(); }, reason === 'change' ? 1500 : 0);
}

/** Keeps the Google Sheet current: on open, when the app returns to the front, when internet comes back, and every few minutes. */
export function startSyncTriggers(): () => void {
  requestSync('open');
  const offActive = onAppActive((active) => { if (active) requestSync('resume'); });
  const offNet = onNetworkUp(() => requestSync('network'));
  const iv = setInterval(() => requestSync('timer'), 5 * 60_000);
  return () => { offActive(); offNet(); clearInterval(iv); clearTimeout(timer); };
}
