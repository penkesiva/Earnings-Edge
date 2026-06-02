import type { SupabaseClient } from '@supabase/supabase-js';
import type { SavedAnalyses, SavedAnalysisTimes } from '@/components/AiBriefAnalysis';

const PROVIDERS = ['openai', 'gemini', 'claude', 'consensus'] as const;
const MODEL_PROVIDERS = ['openai', 'gemini', 'claude'] as const;

export type LoadedBriefAi = {
  analyses: SavedAnalyses;
  analysisAt: SavedAnalysisTimes;
  /** Latest `analyzed_at` across GPT / Gemini / Claude. */
  lastAiScanAt: string | null;
  /** When final verdict (consensus) was last synthesized. */
  lastConsensusAt: string | null;
};

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
): Promise<LoadedBriefAi> {
  const want = normUuid(briefId);

  const { data: direct, error: directErr } = await sb
    .from('brief_ai_analyses')
    .select('brief_id, provider, analysis_text, analyzed_at')
    .eq('brief_id', briefId);

  if (directErr) {
    console.error('[brief-ai] eq query error:', directErr.message, directErr.code);
  }

  let rows = direct ?? [];

  if (rows.length === 0) {
    const { data: all, error: allErr } = await sb
      .from('brief_ai_analyses')
      .select('brief_id, provider, analysis_text, analyzed_at')
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
        .select('brief_id, provider, analysis_text, analyzed_at')
        .limit(2000);
      rows = (all ?? []).filter(r => siblingNorm.has(normUuid(r.brief_id)));
    }
  }

  const saved: SavedAnalyses = {};
  const analysisAt: SavedAnalysisTimes = {};
  let lastAiScanAt: string | null = null;
  let lastConsensusAt: string | null = null;
  for (const row of rows) {
    const p = row.provider as string;
    const at = (row.analyzed_at as string | null) ?? null;
    if ((PROVIDERS as readonly string[]).includes(p)) {
      saved[p as keyof SavedAnalyses] = row.analysis_text as string;
      if (at) analysisAt[p as keyof SavedAnalysisTimes] = at;
    }
    if ((MODEL_PROVIDERS as readonly string[]).includes(p) && at) {
      if (!lastAiScanAt || at > lastAiScanAt) lastAiScanAt = at;
    }
    if (p === 'consensus' && at) {
      lastConsensusAt = at;
    }
  }

  if (Object.keys(saved).length > 0) {
    console.log('[brief-ai] loaded for', briefId, '→', Object.keys(saved).join(', '));
  }

  return { analyses: saved, analysisAt, lastAiScanAt, lastConsensusAt };
}
