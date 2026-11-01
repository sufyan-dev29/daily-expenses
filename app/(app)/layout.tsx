'use client';
import { useEffect, useState } from 'react';
import { AppProvider } from '@/components/AppProvider';
import { AppShell } from '@/components/AppShell';
import { useSession } from '@/components/auth/SessionProvider';
import { localDb } from '@/lib/local/client';
import { DEFAULT_SETTINGS, type Option, type Settings, type Template } from '@/lib/types';
import { themeCss } from '@/lib/theme';
import { resolveAccent } from '@/lib/local/systemcolor';

interface Loaded { accent: string; settings: Settings; options: Option[]; templates: Template[] }

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const { account } = useSession();
  const [data, setData] = useState<Loaded | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      const db = localDb();
      const [s, o, t] = await Promise.all([
        db.from('user_settings').select('*').maybeSingle(),
        db.from('options').select('*').order('sort_order').order('created_at'),
        db.from('templates').select('*').order('sort_order').order('created_at'),
      ]);
      const settings = { ...DEFAULT_SETTINGS, ...(s.data ?? {}) } as Settings;
      const accent = await resolveAccent(settings.accent_hex);
      if (alive) setData({ accent, settings, options: (o.data ?? []) as Option[], templates: (t.data ?? []) as Template[] });
    })();
    return () => { alive = false; };
  }, [account?.id]);

  if (!data) return null;
  return (
    <>
      {/* the account's accent overrides the default theme from the root layout */}
      <style id="user-theme" dangerouslySetInnerHTML={{ __html: themeCss(data.accent) }} />
      <AppProvider initial={data} username={account?.username ?? ''}>
        <AppShell>{children}</AppShell>
      </AppProvider>
    </>
  );
}
