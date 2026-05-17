import { supabaseAdmin } from '@/lib/supabase';
import { dashboardSessionDate } from '@/lib/earningsDate';
import { HistoryList, type HistoryRow } from '@/components/HistoryList';
import { LogOutcomesButton } from './LogOutcomesButton';

export const dynamic = 'force-dynamic';

export default async function HistoryPage() {
  const sb = supabaseAdmin();
  const today = dashboardSessionDate();

  const { data: rows } = await sb
    .from('v_brief_outcomes')
    .select('*')
    .lt('earnings_date', today)
    .order('earnings_date', { ascending: false })
    .limit(100);

  const historyRows: HistoryRow[] = (rows ?? []).map(r => ({
    brief_id: r.brief_id,
    earnings_date: r.earnings_date,
    ticker: r.ticker,
    composite_score: r.composite_score,
    final_action: r.final_action,
    expected_move_pct: r.expected_move_pct,
    beat_or_miss: r.beat_or_miss,
    surprise_pct: r.surprise_pct,
    next_day_close_pct: r.next_day_close_pct,
    trade_pnl: r.trade_pnl,
    hit: r.hit,
  }));

  const withOutcomes = historyRows.filter(r => r.beat_or_miss && r.final_action !== 'SKIP');
  const hits = withOutcomes.filter(r => r.hit === true);
  const hitRate = withOutcomes.length ? (hits.length / withOutcomes.length) * 100 : 0;
  const pending = historyRows.filter(r => !r.beat_or_miss).length;

  return (
    <div className="space-y-8">
      <div className="flex items-start justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight mb-2">
            <span className="text-fg-subtle">›</span> HISTORY
          </h1>
          <p className="text-sm text-fg-subtle">
            {historyRows.length} past briefs · {withOutcomes.length} with outcomes ·{' '}
            <span className={hitRate >= 55 ? 'text-signal-buy' : hitRate >= 40 ? 'text-signal-watch' : 'text-signal-sell'}>
              {hitRate.toFixed(0)}% hit rate
            </span>
            {pending > 0 && (
              <span className="ml-2 text-fg-dim">· {pending} pending outcomes</span>
            )}
          </p>
        </div>
        <LogOutcomesButton pendingCount={pending} />
      </div>

      <HistoryList rows={historyRows} />
    </div>
  );
}
