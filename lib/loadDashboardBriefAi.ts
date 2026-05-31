import type { SupabaseClient } from '@supabase/supabase-js';

const MODEL_PROVIDERS = ['openai', 'gemini', 'claude'] as const;

function normUuid(id: string): string {
  return String(id).replace(/-/g, '').toLowerCase();
}

export type DashboardBriefAiMeta = {
  consensusText: string | null;
  lastAiScanAt: string | null;
  lastConsensusAt: string | null;
};

/**
 * Load saved verdict + scan timestamps for home dashboard rows.
 */
export async function loadDashboardBriefAiByIds(
  sb: SupabaseClient,
  briefIds: string[],
): Promise<Map<string, DashboardBriefAiMeta>> {
  const out = new Map<string, DashboardBriefAiMeta>();
  if (briefIds.length === 0) return out;

  const want = new Set(briefIds.map(normUuid));

  const { data, error } = await sb
    .from('brief_ai_analyses')
    .select('brief_id, provider, analysis_text, analyzed_at');

  if (error) {
    console.error('[dashboard-brief-ai] query error:', error.message);
    return out;
  }

  const byId = new Map<string, DashboardBriefAiMeta>();

  for (const row of data ?? []) {
    const id = row.brief_id as string;
    if (!want.has(normUuid(id))) continue;

    let meta = byId.get(id);
    if (!meta) {
      meta = { consensusText: null, lastAiScanAt: null, lastConsensusAt: null };
      byId.set(id, meta);
    }

    const provider = row.provider as string;
    const at = (row.analyzed_at as string | null) ?? null;
    const text = (row.analysis_text as string | null)?.trim() ?? null;

    if (provider === 'consensus' && text) {
      meta.consensusText = text;
      if (at && (!meta.lastConsensusAt || at > meta.lastConsensusAt)) {
        meta.lastConsensusAt = at;
      }
    }

    if ((MODEL_PROVIDERS as readonly string[]).includes(provider) && at) {
      if (!meta.lastAiScanAt || at > meta.lastAiScanAt) {
        meta.lastAiScanAt = at;
      }
    }
  }

  for (const id of briefIds) {
    const meta = byId.get(id);
    if (meta) out.set(id, meta);
  }

  return out;
}
