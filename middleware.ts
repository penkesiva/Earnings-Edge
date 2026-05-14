import { NextRequest, NextResponse } from 'next/server';

const COOKIE_NAME = 'ee_session';

/** Paths that bypass the auth gate entirely. */
function isPublic(pathname: string): boolean {
  return (
    pathname === '/login' ||
    pathname.startsWith('/api/auth/') ||
    pathname.startsWith('/_next/') ||
    pathname.startsWith('/favicon')
  );
}

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // Skip if no password is configured (dev convenience — set SITE_PASSWORD to enable).
  const password = process.env.SITE_PASSWORD;
  if (!password) return NextResponse.next();

  if (isPublic(pathname)) return NextResponse.next();

  const session = req.cookies.get(COOKIE_NAME)?.value;
  if (session === password) return NextResponse.next();

  // Redirect to login, preserving the original destination.
  const loginUrl = req.nextUrl.clone();
  loginUrl.pathname = '/login';
  loginUrl.search = '';
  if (pathname !== '/') {
    loginUrl.searchParams.set('next', pathname);
  }
  return NextResponse.redirect(loginUrl);
}

export const config = {
  // Run on every route except static files
  matcher: ['/((?!_next/static|_next/image|favicon\\.ico).*)'],
};
