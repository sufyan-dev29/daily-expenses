import { NextResponse } from 'next/server';
import { loginSchema } from '@/lib/validation';
import { clientIp, rateLimit } from '@/lib/guards';
import { supabaseAdmin, supabaseServer } from '@/lib/supabase/server';

export const runtime = 'nodejs';

const GENERIC = { error: 'Incorrect login details.' };

export async function POST(req: Request) {
  const parsed = loginSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json(GENERIC, { status: 401 });
  const { identifier, password } = parsed.data;

  if (!rateLimit(`login:${clientIp(req)}`, 10, 5 * 60_000) || !rateLimit(`login:${identifier.toLowerCase()}`, 10, 5 * 60_000)) {
    return NextResponse.json({ error: 'Too many attempts. Try again in a few minutes.' }, { status: 429 });
  }

  let email = identifier;
  if (!identifier.includes('@')) {
    const admin = supabaseAdmin();
    const { data: profile } = await admin.from('profiles').select('id').eq('username', identifier.toLowerCase()).maybeSingle();
    if (!profile) return NextResponse.json(GENERIC, { status: 401 });
    const { data: u } = await admin.auth.admin.getUserById(profile.id);
    if (!u.user?.email) return NextResponse.json(GENERIC, { status: 401 });
    email = u.user.email;
  }

  const supabase = await supabaseServer();
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) return NextResponse.json(GENERIC, { status: 401 });
  return NextResponse.json({ ok: true });
}
