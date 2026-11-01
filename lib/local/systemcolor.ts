'use client';
import { registerPlugin } from '@capacitor/core';

/** The accent colour value that means "follow the phone's colours". */
export const SYSTEM_ACCENT = 'system';
export const FALLBACK_ACCENT = '#006A6A';

const Plugin = registerPlugin<{ get(): Promise<{ seed?: string }> }>('SystemColors');
let cached: string | null = null;

/** Reads the phone's accent colour again (it changes when the wallpaper or colour setting changes). */
export async function refreshSystemSeed(): Promise<string> {
  try {
    const r = await Plugin.get();
    cached = r.seed && /^#[0-9A-Fa-f]{6}$/.test(r.seed) ? r.seed : FALLBACK_ACCENT;
  } catch { cached = FALLBACK_ACCENT; }
  return cached;
}

/** Turns the stored value into a real colour: "system" becomes the phone's accent, anything else is unchanged. */
export async function resolveAccent(value: string): Promise<string> {
  if (value !== SYSTEM_ACCENT) return value;
  return cached ?? refreshSystemSeed();
}
