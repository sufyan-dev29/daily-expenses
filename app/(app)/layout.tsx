import { redirect } from 'next/navigation';
import { supabaseServer } from '@/lib/supabase/server';
import { AppProvider } from '@/components/AppProvider';
import { AppShell } from '@/components/AppShell';
import { DEFAULT_SETTINGS, type Option, type Settings, type Template } from '@/lib/types';
import { themeCss } from '@/lib/theme';

export const dynamic = 'force-dynamic';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const supabase = await supabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const [settingsRes, optionsRes, templatesRes, profileRes] = await Promise.all([
    supabase.from('user_settings').select('*').maybeSingle(),
    supabase.from('options').select('*').order('sort_order').order('created_at'),
    supabase.from('templates').select('*').order('sort_order').order('created_at'),
    supabase.from('profiles').select('username').maybeSingle(),
  ]);

  const settings: Settings = { ...DEFAULT_SETTINGS, ...(settingsRes.data ?? {}) } as Settings;

  return (
    <>
      {/* user's accent overrides the default theme generated in the root layout */}
      <style id="user-theme" dangerouslySetInnerHTML={{ __html: themeCss(settings.accent_hex) }} />
      <AppProvider
        initial={{ settings, options: (optionsRes.data ?? []) as Option[], templates: (templatesRes.data ?? []) as Template[] }}
        username={profileRes.data?.username ?? ''}
        email={user.email ?? ''}
      >
        <AppShell>{children}</AppShell>
      </AppProvider>
    </>
  );
}
