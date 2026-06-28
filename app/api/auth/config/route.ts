import { NextResponse } from 'next/server';

export async function GET() {
  return NextResponse.json({
    passwordLogin: !!process.env.SITE_PASSWORD?.trim(),
    googleLogin: !!(
      process.env.NEXT_PUBLIC_SUPABASE_URL &&
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    ),
  });
}
