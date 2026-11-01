import { NextResponse } from 'next/server';
import { requireUser, unauthorized } from '@/lib/guards';
import { googleKeySchema } from '@/lib/validation';
import { deleteSecret, loadSecret, saveSecret } from '@/lib/secrets';

export const runtime = 'nodejs';

// Never returns the key. Only whether one exists and the service-account email (so the user knows who to share the sheet with).
export async function GET() {
  const { user } = await requireUser();
  if (!user) return unauthorized();
  const raw = await loadSecret(user.id, 'google_sa');
  if (!raw) return NextResponse.json({ configured: false, email: null });
  try {
    return NextResponse.json({ configured: true, email: JSON.parse(raw).client_email ?? null });
  } catch {
    return NextResponse.json({ configured: true, email: null });
  }
}

export async function PUT(req: Request) {
  const { user } = await requireUser();
  if (!user) return unauthorized();
  const parsed = googleKeySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'Paste the full JSON key file contents.' }, { status: 400 });
  try {
    const j = JSON.parse(parsed.data.json);
    if (!j.client_email || !j.private_key) throw new Error();
    await saveSecret(user.id, 'google_sa', JSON.stringify({ client_email: j.client_email, private_key: j.private_key }));
    return NextResponse.json({ ok: true, email: j.client_email });
  } catch {
    return NextResponse.json({ error: 'That is not a valid service account key (needs client_email and private_key).' }, { status: 400 });
  }
}

export async function DELETE() {
  const { user } = await requireUser();
  if (!user) return unauthorized();
  await deleteSecret(user.id, 'google_sa');
  return NextResponse.json({ ok: true });
}
