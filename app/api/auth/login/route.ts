import { NextRequest, NextResponse } from 'next/server';

const COOKIE_NAME = 'ee_session';
// 30 days — survives across phone + desktop sessions
const MAX_AGE = 60 * 60 * 24 * 30;

export async function POST(req: NextRequest) {
  const { password } = (await req.json()) as { password?: string };

  const sitePassword = process.env.SITE_PASSWORD;
  if (!sitePassword) {
    // No password configured — allow through (dev mode)
    return NextResponse.json({ ok: true });
  }

  if (!password || password !== sitePassword) {
    return NextResponse.json({ error: 'Wrong password' }, { status: 401 });
  }

  const res = NextResponse.json({ ok: true });
  res.cookies.set(COOKIE_NAME, sitePassword, {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    maxAge: MAX_AGE,
    path: '/',
  });
  return res;
}
