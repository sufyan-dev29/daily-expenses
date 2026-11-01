'use client';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { Option, OptionKind, Settings, Template } from '@/lib/types';
import { localDb } from '@/lib/local/client';
import { formatMoney, relativeDayLabel, todayInTz } from '@/lib/format';
import { themeCss } from '@/lib/theme';
import { SnackbarProvider } from '@/components/ui';

interface Ctx {
  settings: Settings;
  options: Option[];
  templates: Template[];
  username: string;
  setSettings: (patch: Partial<Settings>) => Promise<string | null>;
  refreshOptions: () => Promise<void>;
  refreshTemplates: () => Promise<void>;
  refreshSettings: () => Promise<void>;
  optionsOf: (kind: OptionKind, includeArchived?: boolean) => Option[];
  optionName: (id: string | null | undefined) => string;
  optionById: (id: string | null | undefined) => Option | undefined;
  money: (n: number) => string;
  today: () => string;
  dayLabel: (iso: string) => string;
}

const AppCtx = createContext<Ctx | null>(null);
export const useApp = () => {
  const c = useContext(AppCtx);
  if (!c) throw new Error('useApp outside provider');
  return c;
};

/** Let colours glide for a moment instead of snapping (class is removed again right after). */
function glide() {
  const el = document.documentElement;
  el.classList.add('theme-switching');
  window.setTimeout(() => el.classList.remove('theme-switching'), 420);
}

function syncThemeColorMeta() {
  const meta = document.querySelector('meta[name=theme-color]');
  const s = getComputedStyle(document.documentElement).getPropertyValue('--md-sys-color-surface').trim();
  if (meta && s) meta.setAttribute('content', s);
}

function applyTheme(mode: Settings['theme_mode'], animate = false) {
  try {
    localStorage.setItem('et-theme', mode);
  } catch {}
  const dark = mode === 'dark' || (mode === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  if (animate && document.documentElement.classList.contains('dark') !== dark) glide();
  document.documentElement.classList.toggle('dark', dark);
  syncThemeColorMeta();
}

/** Re-themes instantly: builds the palette's CSS variables on the phone and swaps them into the page. */
export async function applyPalette(palette: string): Promise<boolean> {
  try {
    const css = themeCss(palette);
    let el = document.getElementById('user-theme') as HTMLStyleElement | null;
    if (!el) {
      el = document.createElement('style');
      el.id = 'user-theme';
      document.head.appendChild(el);
    }
    glide();
    el.textContent = css;
    syncThemeColorMeta();
    return true;
  } catch {
    return false;
  }
}

export function AppProvider({
  children,
  initial,
  username,
}: {
  children: ReactNode;
  initial: { settings: Settings; options: Option[]; templates: Template[] };
  username: string;
}) {
  const [settings, setSettingsState] = useState(initial.settings);
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const [options, setOptions] = useState(initial.options);
  const [templates, setTemplates] = useState(initial.templates);

  // theme: follow the setting, and follow the OS while in "system" mode
  useEffect(() => {
    applyTheme(settings.theme_mode, true);
    if (settings.theme_mode !== 'system') return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const f = () => applyTheme('system', true);
    mq.addEventListener('change', f);
    return () => mq.removeEventListener('change', f);
  }, [settings.theme_mode]);

  const refreshOptions = useCallback(async () => {
    const { data } = await localDb().from('options').select('*').order('sort_order').order('created_at');
    if (data) setOptions(data as Option[]);
  }, []);
  const refreshTemplates = useCallback(async () => {
    const { data } = await localDb().from('templates').select('*').order('sort_order').order('created_at');
    if (data) setTemplates(data as Template[]);
  }, []);
  const refreshSettings = useCallback(async () => {
    const { data } = await localDb().from('user_settings').select('*').maybeSingle();
    if (data) setSettingsState(data as Settings);
  }, []);

  const setSettings = useCallback(async (patch: Partial<Settings>) => {
    const before = settingsRef.current;
    setSettingsState((s) => ({ ...s, ...patch }));
    // new palette: re-theme right now over AJAX (no page reload), save in the background
    if (patch.accent_hex) await applyPalette(patch.accent_hex);
    const { sheet: _ignored, ...body } = patch;
    const { error } = await localDb().from('user_settings').update(body);
    if (error) {
      // roll back what we changed optimistically
      setSettingsState((s) => ({ ...s, ...Object.fromEntries(Object.keys(patch).map((k) => [k, before[k as keyof Settings]])) }));
      if (patch.accent_hex) applyPalette(before.accent_hex);
      return error.message || 'Could not save';
    }
    return null;
  }, []);

  const value = useMemo<Ctx>(() => {
    const byId = new Map(options.map((o) => [o.id, o]));
    return {
      settings,
      options,
      templates,
      username,
      setSettings,
      refreshOptions,
      refreshTemplates,
      refreshSettings,
      optionsOf: (kind, includeArchived = false) => options.filter((o) => o.kind === kind && (includeArchived || !o.archived_at)),
      optionById: (id) => (id ? byId.get(id) : undefined),
      optionName: (id) => (id ? byId.get(id)?.name ?? '' : ''),
      money: (n) => formatMoney(n, settings.currency, settings.locale),
      today: () => todayInTz(settings.timezone),
      dayLabel: (iso) => relativeDayLabel(iso, settings.timezone, settings.date_format),
    };
  }, [settings, options, templates, username, setSettings, refreshOptions, refreshTemplates, refreshSettings]);

  return (
    <AppCtx.Provider value={value}>
      <SnackbarProvider>{children}</SnackbarProvider>
    </AppCtx.Provider>
  );
}
