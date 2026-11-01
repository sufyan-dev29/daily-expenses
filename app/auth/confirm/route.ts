import { NextResponse, type NextRequest } from 'next/server';
import type { EmailOtpType } from '@supabase/supabase-js';
import { supabaseServer } from '@/lib/supabase/server';

export const runtime = 'nodejs';

// Email links land here: verifies the one-time token, sets the session cookie, then goes to /reset.
export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const token_hash = searchParams.get('token_hash');
  const type = (searchParams.get('type') ?? 'recovery') as EmailOtpType;
  const code = searchParams.get('code');

  const supabase = await supabaseServer();
  let ok = false;
  if (token_hash) {
    ok = !(await supabase.auth.verifyOtp({ type, token_hash })).error;
  } else if (code) {
    ok = !(await supabase.auth.exchangeCodeForSession(code)).error;
  }
  return NextResponse.redirect(`${origin}${ok ? '/reset' : '/login?error=link'}`);
}
