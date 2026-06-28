/**
 * POST /api/internal/save-ai-analysis
 *
 * Upserts a completed AI analysis for a brief.
 * Called fire-and-forget from the client after streaming finishes.
 *
 * Body: { brief_id: string, provider: 'openai' | 'gemini' | 'claude', text: string }
 */
import { NextRequest, NextResponse } from 'next/server';
import { isAuthApiResult, requireAuthApi } from '@/lib/authServer';

export async function POST(req: NextRequest) {
  try {
    const auth = await requireAuthApi();
    if (!isAuthApiResult(auth)) return auth;

    const { brief_id, provider, text } = (await req.json()) as {
      brief_id?: string;
      provider?: string;
      text?: string;
    };

    if (!brief_id || !provider || !text) {
      return NextResponse.json({ error: 'brief_id, provider, and text are required' }, { status: 400 });
    }

    const VALID_PROVIDERS = ['openai', 'gemini', 'claude', 'consensus'];
    if (!VALID_PROVIDERS.includes(provider)) {
      return NextResponse.json({ error: `Unknown provider: ${provider}` }, { status: 400 });
    }

    console.log('[save-ai-analysis] upserting', { brief_id, provider, textLen: text.length });

    const { error } = await auth.sb
      .from('brief_ai_analyses')
      .upsert(
        { brief_id, provider, analysis_text: text, analyzed_at: new Date().toISOString() },
        { onConflict: 'brief_id,provider' }
      );

    if (error) {
      console.error('[save-ai-analysis] error:', error.message, { brief_id, provider });
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    console.log('[save-ai-analysis] saved OK', { brief_id, provider });
    return NextResponse.json({ ok: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
