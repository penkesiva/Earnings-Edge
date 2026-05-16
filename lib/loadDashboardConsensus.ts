import type { SupabaseClient } from '@supabase/supabase-js';

function normUuid(id: string): string {
  return String(id).replace(/-/g, '').toLowerCase();
}

/**
 * Load saved Final Verdict (consensus provider) text keyed by brief_id.
 */
export async function loadConsensusByBriefIds(
  sb: SupabaseClient,
  briefIds: string[]
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (briefIds.length === 0) return out;

  const want = new Set(briefIds.map(normUuid));

  const { data, error } = await sb
    .from('brief_ai_analyses')
    .select('brief_id, analysis_text')
    .eq('provider', 'consensus');

  if (error) {
    console.error('[dashboard-consensus] query error:', error.message);
    return out;
  }

  for (const row of data ?? []) {
    const id = row.brief_id as string;
    if (!want.has(normUuid(id))) continue;
    const text = (row.analysis_text as string)?.trim();
    if (text) out.set(id, text);
  }

  return out;
}
