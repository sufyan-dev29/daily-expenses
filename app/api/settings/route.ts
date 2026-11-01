import { NextResponse } from 'next/server';
import { requireUser, unauthorized } from '@/lib/guards';
import { settingsPatchSchema } from '@/lib/validation';

export const runtime = 'nodejs';

export async function PATCH(req: Request) {
  const { supabase, user } = await requireUser();
  if (!user) return unauthorized();
  const parsed = settingsPatchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message }, { status: 400 });
  const { error } = await supabase.from('user_settings').update(parsed.data).eq('user_id', user.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ ok: true });
}
