import { NextResponse } from 'next/server';
import { forgotSchema } from '@/lib/validation';
import { clientIp, rateLimit } from '@/lib/guards';
import { supabaseAdmin, supabaseServer } from '@/lib/supabase/server';
import { loadSmtp } from '@/lib/secrets';
import { recoveryEmail, sendMail } from '@/lib/mailer';

export const runtime = 'nodejs';

// Always answers the same way, whether or not the account exists (no enumeration).
const OK = NextResponse.json({ ok: true });

export async function POST(req: Request) {
  const parsed = forgotSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return OK;
  if (!rateLimit(`forgot:${clientIp(req)}`, 5, 15 * 60_000)) return OK;

  try {
    const admin = supabaseAdmin();
    let email = parsed.data.identifier;
    let userId: string | null = null;

    if (!email.includes('@')) {
      const { data: profile } = await admin.from('profiles').select('id').eq('username', email.toLowerCase()).maybeSingle();
      if (!profile) return OK;
      const { data: u } = await admin.auth.admin.getUserById(profile.id);
      if (!u.user?.email) return OK;
      email = u.user.email;
      userId = profile.id;
    }

    const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? new URL(req.url).origin;

    // Preferred path: build our own link and send it through the SMTP saved in Settings.
    const { data: link } = await admin.auth.admin.generateLink({ type: 'recovery', email });
    userId = userId ?? link?.user?.id ?? null;
    const smtp = userId ? await loadSmtp(userId).catch(() => null) : null;

    if (smtp && link?.properties?.hashed_token) {
      const url = `${appUrl}/auth/confirm?token_hash=${encodeURIComponent(link.properties.hashed_token)}&type=recovery`;
      const mail = recoveryEmail(url);
      await sendMail(smtp, email, mail.subject, mail.text, mail.html);
      return OK;
    }

    // Fallback: Supabase sends it (uses the SMTP configured in the Supabase dashboard, if any).
    const supabase = await supabaseServer();
    await supabase.auth.resetPasswordForEmail(email, { redirectTo: `${appUrl}/auth/confirm?next=/reset` });
  } catch {
    // swallow: never reveal anything
  }
  return OK;
}
