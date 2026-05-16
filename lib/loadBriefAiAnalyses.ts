import type { SupabaseClient } from '@supabase/supabase-js';
import type { SavedAnalyses } from '@/components/AiBriefAnalysis';

const PROVIDERS = ['openai', 'gemini', 'claude', 'consensus'] as const;

function normUuid(id: string): string {
  return String(id).replace(/-/g, '').toLowerCase();
}

/**
 * Load persisted AI analyses for a brief.
 * Tries PostgREST .eq() first, then JS filter (UUID eq quirk), then sibling brief ids.
 */
export async function loadBriefAiAnalyses(
  sb: SupabaseClient,
  briefId: string,
  ticker: string,
  earningsDate: string
): Promise<SavedAnalyses> {
  const want = normUuid(briefId);

  const { data: direct, error: directErr } = await sb
    .from('brief_ai_analyses')
    .select('brief_id, provider, analysis_text')
    .eq('brief_id', briefId);

  if (directErr) {
    console.error('[brief-ai] eq query error:', directErr.message, directErr.code);
  }

  let rows = direct ?? [];

  if (rows.length === 0) {
    const { data: all, error: allErr } = await sb
      .from('brief_ai_analyses')
      .select('brief_id, provider, analysis_text')
      .limit(2000);

    if (allErr) {
      console.error('[brief-ai] full table query error:', allErr.message);
    } else {
      rows = (all ?? []).filter(r => normUuid(r.brief_id) === want);
    }
  }

  // Same ticker + earnings date (covers rare brief row replacement)
  if (rows.length === 0) {
    const { data: siblings } = await sb
      .from('earnings_briefs')
      .select('id')
      .eq('ticker', ticker)
      .eq('earnings_date', earningsDate);

    const siblingNorm = new Set((siblings ?? []).map(b => normUuid(b.id)));
    if (siblingNorm.size > 0) {
      const { data: all } = await sb
        .from('brief_ai_analyses')
        .select('brief_id, provider, analysis_text')
        .limit(2000);
      rows = (all ?? []).filter(r => siblingNorm.has(normUuid(r.brief_id)));
    }
  }

  const saved: SavedAnalyses = {};
  for (const row of rows) {
    const p = row.provider as string;
    if ((PROVIDERS as readonly string[]).includes(p)) {
      saved[p as keyof SavedAnalyses] = row.analysis_text as string;
    }
  }

  if (Object.keys(saved).length > 0) {
    console.log('[brief-ai] loaded for', briefId, '→', Object.keys(saved).join(', '));
  }

  return saved;
}
