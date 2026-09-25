import { aggregateBacktestMetrics } from '@/lib/intraday/backtest/metrics';
import type { BacktestMetricsExtended, BacktestTrade, SignalLogEntry } from '@/lib/intraday/types';

export function aggregateV2BacktestMetrics(
  trades: BacktestTrade[],
  tradingDays: number,
  signalLog: SignalLogEntry[],
  slippageBps: number,
  commissionPerShare: number,
): BacktestMetricsExtended {
  const base = aggregateBacktestMetrics(trades, tradingDays);
  const rejectedSignals = signalLog.filter(s => !s.accepted).length;

  const byRegime: Record<string, { trades: number; pnlUsd: number }> = {};
  for (const t of trades) {
    const r = t.regimeAtEntry ?? 'UNKNOWN';
    byRegime[r] = byRegime[r] ?? { trades: 0, pnlUsd: 0 };
    byRegime[r].trades += 1;
    byRegime[r].pnlUsd += t.pnlUsd;
  }

  const pnls = trades.map(t => t.pnlUsd);
  const largestWinnerUsd = pnls.length ? Math.max(...pnls) : null;
  const largestLoserUsd = pnls.length ? Math.min(...pnls) : null;
  const expectancyPerTrade = pnls.length ? pnls.reduce((a, b) => a + b, 0) / pnls.length : null;

  const mfe = trades.map(t => t.mfeUsd).filter((n): n is number => n != null);
  const mae = trades.map(t => t.maeUsd).filter((n): n is number => n != null);

  return {
    ...base,
    expectancyPerTrade,
    largestWinnerUsd,
    largestLoserUsd,
    avgMfeUsd: mfe.length ? mfe.reduce((a, b) => a + b, 0) / mfe.length : null,
    avgMaeUsd: mae.length ? mae.reduce((a, b) => a + b, 0) / mae.length : null,
    byRegime,
    rejectedSignals,
    slippageBps,
    commissionPerShare,
  };
}
