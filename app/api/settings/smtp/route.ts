import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireUser, unauthorized } from '@/lib/guards';
import { smtpSchema } from '@/lib/validation';
import { loadSmtp, maskSmtp, saveSmtp } from '@/lib/secrets';
import { sendMail } from '@/lib/mailer';

export const runtime = 'nodejs';

export async function GET() {
  const { user } = await requireUser();
  if (!user) return unauthorized();
  return NextResponse.json({ smtp: maskSmtp(await loadSmtp(user.id)) });
}

export async function PUT(req: Request) {
  const { user } = await requireUser();
  if (!user) return unauthorized();
  const parsed = smtpSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message }, { status: 400 });
  const prev = await loadSmtp(user.id);
  const pass = parsed.data.pass ? parsed.data.pass : prev?.pass ?? '';
  await saveSmtp(user.id, { ...parsed.data, pass });
  return NextResponse.json({ ok: true });
}

// "Send test email"
export async function POST(req: Request) {
  const { user } = await requireUser();
  if (!user) return unauthorized();
  const parsed = z.object({ to: z.string().email().optional() }).safeParse(await req.json().catch(() => ({})));
  const cfg = await loadSmtp(user.id);
  if (!cfg) return NextResponse.json({ error: 'Save your SMTP settings first.' }, { status: 400 });
  const to = (parsed.success && parsed.data.to) || user.email!;
  try {
    await sendMail(cfg, to, 'Expense tracker test email', 'Your SMTP settings work.');
    return NextResponse.json({ ok: true, to });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
