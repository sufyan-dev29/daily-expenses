import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

const PUBLIC_PATHS = ['/login', '/forgot', '/reset', '/setup', '/api/setup', '/api/auth', '/auth', '/offline'];
const PUBLIC_FILES = ['/manifest.webmanifest', '/sw.js', '/icon', '/apple-icon', '/favicon.ico', '/robots.txt'];

export async function updateSession(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Cron routes authenticate with CRON_SECRET inside the handler.
  if (pathname.startsWith('/api/cron/')) return NextResponse.next();
  if (PUBLIC_FILES.some((p) => pathname === p || pathname.startsWith(p))) return NextResponse.next();

  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (list: { name: string; value: string; options: CookieOptions }[]) => {
          list.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          list.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
        },
      },
    },
  );

  // getUser() validates the JWT with Supabase (never trust getSession() alone on the server)
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const isPublic = PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(p + '/'));

  if (!user && !isPublic) {
    if (pathname.startsWith('/api/')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    url.search = '';
    return NextResponse.redirect(url);
  }

  if (user && (pathname === '/login' || pathname === '/forgot')) {
    const url = request.nextUrl.clone();
    url.pathname = '/expense';
    url.search = '';
    return NextResponse.redirect(url);
  }

  return response;
}
