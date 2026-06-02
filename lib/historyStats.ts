/** Actions that mean “no trade” — excluded from structure hit rate. */
export const SKIP_ACTIONS = new Set([
  'SKIP',
  'SKIP_NO_EDGE',
  'SKIP_CONFLICT',
  'SKIP_ASYMMETRIC_DOWNSIDE_RISK',
  'SKIP_ASYMMETRIC_UPSIDE_RISK',
]);

export const WATCH_ACTIONS = new Set(['BEARISH_WATCH', 'BULLISH_WATCH']);

export type HistoryStatsRow = {
  brief_id: string;
  ticker: string;
  earnings_date: string;
  final_action: string | null;
  beat_or_miss: string | null;
  next_day_close_pct: number | null;
  hit: boolean | null;
  expected_move_pct?: number | null;
  consensus_verdict?: string | null;
  consensus_direction?: string | null;
  consensus_confidence?: number | null;
  consensus_trade_type?: string | null;
  consensus_hit?: boolean | null;
};

export function isSkipAction(action: string | null | undefined): boolean {
  if (!action) return true;
  if (SKIP_ACTIONS.has(action)) return true;
  if (action.startsWith('SKIP_')) return true;
  return false;
}

/** System assigned a trade structure that log-outcomes can score. */
export function isScorableStructure(action: string | null | undefined): boolean {
  if (!action || isSkipAction(action)) return false;
  if (WATCH_ACTIONS.has(action)) return false;
  return true;
}

export type HistoryStats = {
  totalBriefs: number;
  epsLogged: number;
  pendingEps: number;
  skipped: number;
  awaitingPrice: number;
  scored: number;
  hits: number;
  misses: number;
  structureHitRate: number | null;
  consensusScored: number;
  consensusHits: number;
  consensusMisses: number;
  consensusHitRate: number | null;
  recentMisses: HistoryStatsRow[];
};

export function computeHistoryStats(rows: HistoryStatsRow[]): HistoryStats {
  const epsLogged = rows.filter(r => r.beat_or_miss);
  const pendingEps = rows.filter(r => !r.beat_or_miss);
  const skipped = epsLogged.filter(r => !isScorableStructure(r.final_action));
  const tradeable = epsLogged.filter(r => isScorableStructure(r.final_action));
  const awaitingPrice = tradeable.filter(r => r.next_day_close_pct == null);
  const scored = tradeable.filter(r => r.hit === true || r.hit === false);
  const hits = scored.filter(r => r.hit === true);
  const misses = scored.filter(r => r.hit === false);
  const structureHitRate = scored.length
    ? (hits.length / scored.length) * 100
    : null;
  const consensusScored = rows.filter(r => r.consensus_hit === true || r.consensus_hit === false);
  const consensusHits = consensusScored.filter(r => r.consensus_hit === true);
  const consensusMisses = consensusScored.filter(r => r.consensus_hit === false);
  const consensusHitRate = consensusScored.length
    ? (consensusHits.length / consensusScored.length) * 100
    : null;

  const recentMisses = misses
    .slice()
    .sort((a, b) => b.earnings_date.localeCompare(a.earnings_date))
    .slice(0, 5);

  return {
    totalBriefs: rows.length,
    epsLogged: epsLogged.length,
    pendingEps: pendingEps.length,
    skipped: skipped.length,
    awaitingPrice: awaitingPrice.length,
    scored: scored.length,
    hits: hits.length,
    misses: misses.length,
    structureHitRate,
    consensusScored: consensusScored.length,
    consensusHits: consensusHits.length,
    consensusMisses: consensusMisses.length,
    consensusHitRate,
    recentMisses,
  };
}

export function hitRateColor(rate: number | null): string {
  if (rate == null) return 'text-fg-subtle';
  if (rate >= 55) return 'text-signal-buy';
  if (rate >= 40) return 'text-signal-watch';
  return 'text-signal-sell';
}
