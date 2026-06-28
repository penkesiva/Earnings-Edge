import { NextRequest, NextResponse } from 'next/server';
import { authGateEnabled, isEmailAllowed } from '@/lib/authAllowlist';
import { getSupabaseAuthUser } from '@/lib/supabase/middleware';

function isPublic(pathname: string): boolean {
  return (
    pathname === '/login' ||
    pathname.startsWith('/api/auth/') ||
    pathname.startsWith('/auth/') ||
    pathname.startsWith('/_next/') ||
    pathname.startsWith('/favicon')
  );
}

function redirectToLogin(req: NextRequest, reason?: string) {
  const loginUrl = req.nextUrl.clone();
  loginUrl.pathname = '/login';
  loginUrl.search = '';
  if (reason) loginUrl.searchParams.set('error', reason);
  else if (req.nextUrl.pathname !== '/') {
    loginUrl.searchParams.set('next', req.nextUrl.pathname);
  }
  return NextResponse.redirect(loginUrl);
}

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // Supabase sometimes falls back to Site URL with ?code= on / — forward to our handler.
  const authCode = req.nextUrl.searchParams.get('code');
  if (authCode && pathname !== '/auth/callback') {
    const callbackUrl = req.nextUrl.clone();
    callbackUrl.pathname = '/auth/callback';
    if (!callbackUrl.searchParams.has('next') && pathname !== '/') {
      callbackUrl.searchParams.set('next', pathname);
    }
    return NextResponse.redirect(callbackUrl);
  }

  if (isPublic(pathname)) return NextResponse.next();

  if (pathname.startsWith('/api/cron/')) {
    const secret = process.env.CRON_SECRET;
    const auth = req.headers.get('authorization');
    if (secret && auth === `Bearer ${secret}`) return NextResponse.next();
  }

  if (!authGateEnabled()) return NextResponse.next();

  const { response, user } = await getSupabaseAuthUser(req);

  if (user?.email && isEmailAllowed(user.email)) {
    return response;
  }

  if (user?.email && !isEmailAllowed(user.email)) {
    return redirectToLogin(req, 'not_allowed');
  }

  return redirectToLogin(req);
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon\\.ico).*)'],
};
