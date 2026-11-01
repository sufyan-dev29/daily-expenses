import { NextResponse } from 'next/server';
import { resetSchema } from '@/lib/validation';
import { requireUser, unauthorized } from '@/lib/guards';

export const runtime = 'nodejs';

// Used by /reset (after the email link) and by Settings > change password. Requires a session.
export async function POST(req: Request) {
  const { supabase, user } = await requireUser();
  if (!user) return unauthorized();
  const parsed = resetSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message }, { status: 400 });
  const { error } = await supabase.auth.updateUser({ password: parsed.data.password });
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ ok: true });
}
