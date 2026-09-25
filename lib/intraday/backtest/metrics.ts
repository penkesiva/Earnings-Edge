import type { BacktestMetrics, BacktestTrade } from '@/lib/intraday/types';

export function aggregateBacktestMetrics(trades: BacktestTrade[], tradingDays: number): BacktestMetrics {
  const wins = trades.filter(t => t.pnlUsd > 0);
  const losses = trades.filter(t => t.pnlUsd <= 0);
  const totalPnlUsd = trades.reduce((a, t) => a + t.pnlUsd, 0);
  const grossWin = wins.reduce((a, t) => a + t.pnlUsd, 0);
  const grossLoss = Math.abs(losses.reduce((a, t) => a + t.pnlUsd, 0));

  let peak = 0;
  let equity = 0;
  let maxDd = 0;
  for (const t of trades) {
    equity += t.pnlUsd;
    peak = Math.max(peak, equity);
    maxDd = Math.max(maxDd, peak - equity);
  }

  const bySetup: Record<string, { trades: number; pnlUsd: number }> = {};
  for (const t of trades) {
    bySetup[t.setupType] = bySetup[t.setupType] ?? { trades: 0, pnlUsd: 0 };
    bySetup[t.setupType].trades += 1;
    bySetup[t.setupType].pnlUsd += t.pnlUsd;
  }

  const holdMinutes = trades.map(t => timeDiffMinutes(t.entryTimeEt, t.exitTimeEt)).filter(n => n != null) as number[];

  return {
    tradingDays,
    trades: trades.length,
    wins: wins.length,
    losses: losses.length,
    winRate: trades.length ? (wins.length / trades.length) * 100 : null,
    totalPnlUsd,
    avgWinnerUsd: wins.length ? grossWin / wins.length : null,
    avgLoserUsd: losses.length ? -grossLoss / losses.length : null,
    profitFactor: grossLoss > 0 ? grossWin / grossLoss : grossWin > 0 ? null : null,
    maxDrawdownUsd: maxDd,
    avgHoldMinutes: holdMinutes.length
      ? holdMinutes.reduce((a, b) => a + b, 0) / holdMinutes.length
      : null,
    tradesPerDay: tradingDays ? trades.length / tradingDays : null,
    bySetup,
  };
}

function timeDiffMinutes(entry: string, exit: string): number | null {
  const toMin = (hhmm: string) => {
    const [h, m] = hhmm.split(':').map(Number);
    if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
    return h * 60 + m;
  };
  const a = toMin(entry);
  const b = toMin(exit);
  if (a == null || b == null) return null;
  return Math.max(0, b - a);
}
