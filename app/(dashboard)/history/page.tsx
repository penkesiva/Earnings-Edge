import { requireAuthSession } from '@/lib/authServer';
import { dashboardSessionDate } from '@/lib/earningsDate';
import { computeHistoryStats } from '@/lib/historyStats';
import { HistoryList, type HistoryRow } from '@/components/HistoryList';
import { HistoryStatsPanel } from '@/components/HistoryStatsPanel';
import { LogOutcomesButton } from './LogOutcomesButton';

export const dynamic = 'force-dynamic';

export default async function HistoryPage() {
  const { sb } = await requireAuthSession();
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
    consensus_verdict: r.consensus_verdict,
    consensus_direction: r.consensus_direction,
    consensus_confidence: r.consensus_confidence,
    consensus_trade_type: r.consensus_trade_type,
    consensus_hit: r.consensus_hit,
  }));

  const stats = computeHistoryStats(historyRows);

  return (
    <div className="space-y-8">
      <div className="flex items-start justify-between flex-wrap gap-4">
        <div className="min-w-0">
          <h1 className="text-3xl font-bold tracking-tight mb-2">
            <span className="text-fg-subtle">›</span> HISTORY
          </h1>
          <p className="text-sm text-fg-subtle">
            Outcome tracking for past earnings briefs
          </p>
        </div>
        <LogOutcomesButton pendingCount={stats.pendingEps + stats.awaitingPrice} />
      </div>

      <HistoryStatsPanel rows={historyRows} />

      <HistoryList rows={historyRows} />
    </div>
  );
}
