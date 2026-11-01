'use client';
import { Capacitor } from '@capacitor/core';
import { App } from '@capacitor/app';
import { Network } from '@capacitor/network';
import { Filesystem, Directory, Encoding } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';

export const isNative = () => Capacitor.isNativePlatform();

export const store = {
  get(k: string): string | null { try { return localStorage.getItem(k); } catch { return null; } },
  set(k: string, v: string) { try { localStorage.setItem(k, v); } catch {} },
  del(k: string) { try { localStorage.removeItem(k); } catch {} },
};

function b64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

/** Writes a file to the app's cache and opens the Android share sheet (Save to Drive, Files, WhatsApp…). */
export async function saveAndShare(opts: { filename: string; data: string | Uint8Array; dialogTitle: string }): Promise<void> {
  const safe = opts.filename.replace(/[^A-Za-z0-9._-]/g, '_');
  if (!isNative()) {
    const blob = new Blob([opts.data as BlobPart]);
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = safe; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
    return;
  }
  const written = await Filesystem.writeFile(
    typeof opts.data === 'string'
      ? { path: `exports/${safe}`, data: opts.data, directory: Directory.Cache, encoding: Encoding.UTF8, recursive: true }
      : { path: `exports/${safe}`, data: b64(opts.data), directory: Directory.Cache, recursive: true },
  );
  await Share.share({ title: safe, url: written.uri, dialogTitle: opts.dialogTitle });
}

/** Removes files we left in the cache for sharing. */
export async function clearExports(): Promise<void> {
  if (!isNative()) return;
  await Filesystem.rmdir({ path: 'exports', directory: Directory.Cache, recursive: true }).catch(() => {});
}

export function pickFile(accept: string): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.style.display = 'none';
    let done = false;
    const finish = (f: File | null) => { if (done) return; done = true; input.remove(); resolve(f); };
    input.addEventListener('change', () => finish(input.files?.[0] ?? null));
    input.addEventListener('cancel', () => finish(null));
    document.body.appendChild(input);
    input.click();
  });
}

export const MAX_PICK_BYTES = 300 * 1024 * 1024;

export function readBytes(file: File): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    if (file.size > MAX_PICK_BYTES) return reject(new Error('That file is too large.'));
    const r = new FileReader();
    r.onerror = () => reject(new Error('Could not read that file.'));
    r.onload = () => resolve(new Uint8Array(r.result as ArrayBuffer));
    r.readAsArrayBuffer(file);
  });
}

export async function readText(file: File): Promise<string> {
  const bytes = await readBytes(file);
  let text: string;
  try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
  catch { text = new TextDecoder('windows-1252').decode(bytes); }
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

export function onAppActive(cb: (active: boolean) => void): () => void {
  let handle: { remove: () => Promise<void> } | null = null;
  let removed = false;
  App.addListener('appStateChange', (s) => cb(s.isActive)).then((h) => { if (removed) h.remove(); else handle = h; }).catch(() => {});
  const vis = () => cb(document.visibilityState === 'visible');
  document.addEventListener('visibilitychange', vis);
  return () => { removed = true; handle?.remove(); document.removeEventListener('visibilitychange', vis); };
}

export function onNetworkUp(cb: () => void): () => void {
  let handle: { remove: () => Promise<void> } | null = null;
  let removed = false;
  Network.addListener('networkStatusChange', (s) => { if (s.connected) cb(); }).then((h) => { if (removed) h.remove(); else handle = h; }).catch(() => {});
  window.addEventListener('online', cb);
  return () => { removed = true; handle?.remove(); window.removeEventListener('online', cb); };
}
