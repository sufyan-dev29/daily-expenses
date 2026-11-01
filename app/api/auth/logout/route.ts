import { NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase/server';

export const runtime = 'nodejs';

export async function POST(req: Request) {
  const supabase = await supabaseServer();
  // scope: 'others' signs out every other session; default signs out this one.
  const body = await req.json().catch(() => ({}));
  await supabase.auth.signOut({ scope: body?.scope === 'others' ? 'others' : 'local' });
  return NextResponse.json({ ok: true });
}
