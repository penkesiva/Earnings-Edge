import { NextRequest, NextResponse } from 'next/server';
import { loadAiBriefPayload } from '@/lib/buildAiBriefPayload';
import { supabaseAdmin } from '@/lib/supabase';

/** POST { brief_id } → fresh AiBriefPayload after a system rescan. */
export async function POST(req: NextRequest) {
  let body: { brief_id?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const briefId = body.brief_id?.trim();
  if (!briefId) {
    return NextResponse.json({ error: 'brief_id required' }, { status: 400 });
  }

  const payload = await loadAiBriefPayload(supabaseAdmin(), briefId);
  if (!payload) {
    return NextResponse.json({ error: 'Brief not found' }, { status: 404 });
  }

  return NextResponse.json(payload);
}
