import 'server-only';
import { supabaseAdmin } from '@/lib/supabase/server';
import { decrypt, encrypt } from '@/lib/crypto';

export type SecretKey = 'smtp' | 'google_sa';

export async function saveSecret(userId: string, key: SecretKey, value: string) {
  const { error } = await supabaseAdmin()
    .from('secrets')
    .upsert({ user_id: userId, key, ciphertext: encrypt(value), updated_at: new Date().toISOString() });
  if (error) throw new Error(error.message);
}

export async function loadSecret(userId: string, key: SecretKey): Promise<string | null> {
  const { data, error } = await supabaseAdmin()
    .from('secrets')
    .select('ciphertext')
    .eq('user_id', userId)
    .eq('key', key)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data ? decrypt(data.ciphertext) : null;
}

export async function hasSecret(userId: string, key: SecretKey): Promise<boolean> {
  const { data } = await supabaseAdmin()
    .from('secrets')
    .select('key')
    .eq('user_id', userId)
    .eq('key', key)
    .maybeSingle();
  return !!data;
}

export async function deleteSecret(userId: string, key: SecretKey) {
  await supabaseAdmin().from('secrets').delete().eq('user_id', userId).eq('key', key);
}

// ---- SMTP config: non-secret fields + encrypted password, kept together as one JSON secret
export interface SmtpConfig {
  host: string;
  port: number;
  secure: boolean; // true = implicit TLS (465); false = STARTTLS (587)
  user: string;
  pass: string;
  from: string;
}

export async function loadSmtp(userId: string): Promise<SmtpConfig | null> {
  const raw = await loadSecret(userId, 'smtp');
  return raw ? (JSON.parse(raw) as SmtpConfig) : null;
}

export async function saveSmtp(userId: string, cfg: SmtpConfig) {
  await saveSecret(userId, 'smtp', JSON.stringify(cfg));
}

/** Masked view for the browser: never returns the password. */
export function maskSmtp(cfg: SmtpConfig | null) {
  if (!cfg) return null;
  return { host: cfg.host, port: cfg.port, secure: cfg.secure, user: cfg.user, from: cfg.from, hasPassword: !!cfg.pass };
}
