import { NextResponse } from 'next/server';
import { Webhook } from 'standardwebhooks';
import { supabaseAdmin } from '@/lib/supabase/server';
import { loadSmtp } from '@/lib/secrets';
import { sendMail } from '@/lib/mailer';

export const runtime = 'nodejs';

/**
 * Supabase Auth "Send Email" hook (Authentication > Hooks). Optional: the app already sends reset
 * emails itself via /api/auth/forgot. Use this hook if you want ALL Supabase auth emails to go
 * through the SMTP saved in Settings. Secret goes in SEND_EMAIL_HOOK_SECRET (v1,whsec_...).
 */
export async function POST(req: Request) {
  const secret = process.env.SEND_EMAIL_HOOK_SECRET;
  if (!secret) return NextResponse.json({ error: 'Hook not configured' }, { status: 404 });

  const payload = await req.text();
  const headers = Object.fromEntries(req.headers);
  let event: {
    user: { id: string; email: string };
    email_data: { token_hash: string; email_action_type: string };
  };
  try {
    event = new Webhook(secret.replace(/^v1,whsec_/, '')).verify(payload, headers) as typeof event;
  } catch {
    return NextResponse.json({ error: 'Bad signature' }, { status: 401 });
  }

  try {
    const admin = supabaseAdmin();
    const { data: profile } = await admin.from('profiles').select('id').limit(1).maybeSingle();
    const smtp = profile ? await loadSmtp(profile.id) : null;
    if (!smtp) throw new Error('SMTP is not configured in Settings');

    const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? '';
    const type = event.email_data.email_action_type;
    const link = `${appUrl}/auth/confirm?token_hash=${encodeURIComponent(event.email_data.token_hash)}&type=${type === 'recovery' ? 'recovery' : type}`;
    const subject = type === 'recovery' ? 'Reset your password' : 'Confirm your request';
    await sendMail(smtp, event.user.email, subject, `Open this link:\n${link}`, `<p><a href="${link}">Continue</a></p>`);
    return NextResponse.json({});
  } catch (e) {
    return NextResponse.json({ error: { http_code: 500, message: (e as Error).message } }, { status: 500 });
  }
}
