import { NextResponse } from 'next/server';
import { setupSchema } from '@/lib/validation';
import { checkDb, ownerExists, runMigrations } from '@/lib/migrate';
import { clientIp, rateLimit, tokenMatches } from '@/lib/guards';
import { supabaseAdmin } from '@/lib/supabase/server';
import { STARTER_OPTIONS, defaultIconFor } from '@/lib/seed';

export const runtime = 'nodejs';
export const maxDuration = 60;

// Is the wizard still open? Public, reveals nothing but a boolean.
export async function GET() {
  try {
    const exists = await ownerExists();
    return NextResponse.json({ locked: exists });
  } catch {
    // DB not reachable or not migrated yet: wizard is open
    return NextResponse.json({ locked: false });
  }
}

export async function POST(req: Request) {
  if (!rateLimit(`setup:${clientIp(req)}`, 20, 10 * 60_000)) {
    return NextResponse.json({ error: 'Too many attempts. Wait a few minutes.' }, { status: 429 });
  }

  const parsed = setupSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Invalid input' }, { status: 400 });
  }
  const body = parsed.data;

  if (!process.env.SETUP_TOKEN) {
    return NextResponse.json({ error: 'SETUP_TOKEN is not set on the server.' }, { status: 500 });
  }
  if (!tokenMatches(body.token, process.env.SETUP_TOKEN)) {
    return NextResponse.json({ error: 'Wrong setup token.' }, { status: 403 });
  }

  // The wizard disables itself permanently once an owner exists.
  try {
    if (await ownerExists()) {
      return NextResponse.json({ error: 'Setup is already complete and locked.' }, { status: 403 });
    }
  } catch (e) {
    if (body.step !== 'check' && body.step !== 'migrate') {
      return NextResponse.json({ error: 'Database is not ready. Run the migration step first.' }, { status: 409 });
    }
  }

  try {
    if (body.step === 'check') {
      await checkDb();
      const missing = ['NEXT_PUBLIC_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY', 'ENCRYPTION_KEY', 'CRON_SECRET'].filter(
        (k) => !process.env[k],
      );
      if (missing.length) {
        return NextResponse.json({ error: `Missing environment variables: ${missing.join(', ')}` }, { status: 500 });
      }
      return NextResponse.json({ ok: true });
    }

    if (body.step === 'migrate') {
      const applied = await runMigrations();
      return NextResponse.json({ ok: true, applied });
    }

    // step === 'owner'
    const admin = supabaseAdmin();
    const { data: created, error: createErr } = await admin.auth.admin.createUser({
      email: body.email,
      password: body.password,
      email_confirm: true,
    });
    if (createErr || !created.user) {
      return NextResponse.json({ error: createErr?.message ?? 'Could not create the account' }, { status: 400 });
    }
    const uid = created.user.id;

    const { error: pErr } = await admin.from('profiles').insert({ id: uid, username: body.username });
    if (pErr) {
      await admin.auth.admin.deleteUser(uid);
      return NextResponse.json({ error: pErr.message }, { status: 400 });
    }
    await admin.from('user_settings').insert({ user_id: uid });

    if (body.seed) {
      const rows = (Object.keys(STARTER_OPTIONS) as (keyof typeof STARTER_OPTIONS)[]).flatMap((kind) =>
        STARTER_OPTIONS[kind].map((name, i) => ({
          user_id: uid,
          kind,
          name,
          sort_order: i,
          icon: kind === 'category' || kind === 'income_source' ? defaultIconFor(name) : null,
        })),
      );
      await admin.from('options').insert(rows);
    }
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
