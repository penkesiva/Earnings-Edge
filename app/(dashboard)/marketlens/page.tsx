import { MarketLensPanel } from '@/components/marketLens/MarketLensPanel';
import { loadSessionBars, replaySavedSession, runMarketLensBacktest } from '@/lib/marketLens/backtest';
import { sessionCandles, type CandlePoint } from '@/lib/marketLens/replay';
import type { BacktestSummary, DayReplay } from '@/lib/marketLens/types';
import { lastCompletedSessionDate, sessionWindow } from '@/lib/marketLens/sessionTime';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export default async function MarketLensPage({
  searchParams,
}: {
  searchParams: { days?: string; chart?: string };
}) {
  const sessionDate = lastCompletedSessionDate();
  const requested = Number(searchParams.days);
  const runDays = Number.isFinite(requested) && requested > 0 ? Math.min(20, Math.floor(requested)) : null;

  let replay: DayReplay | null = null;
  let error: string | null = null;
  let summary: BacktestSummary | null = null;
  let days: DayReplay[] = [];
  let chartCandles: CandlePoint[] = [];
  let chartDate: string | null = null;

  try {
    if (runDays) {
      const window = sessionWindow(sessionDate, runDays);
      const result = await runMarketLensBacktest(window.start, window.end);
      days = result.days;
      summary = result.summary;
      replay = days[days.length - 1] ?? null;
      const asked = searchParams.chart;
      chartDate =
        asked && days.some(d => d.sessionDate === asked)
          ? asked
          : (days.find(d => d.trades.length > 0)?.sessionDate ?? null);
    } else {
      replay = await replaySavedSession(sessionDate);
      chartDate = replay.trades.length ? sessionDate : null;
    }
    if (chartDate) {
      const loaded = await loadSessionBars(chartDate);
      chartCandles = sessionCandles(chartDate, loaded.minutes);
    }
  } catch (e) {
    error = e instanceof Error ? e.message : 'Could not load SPY bars.';
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl sm:text-3xl font-bold tracking-tight mb-2">
          <span className="page-chevron">›</span> MARKETLENS
        </h1>
        <p className="text-sm text-fg-subtle max-w-2xl">
          SPY intraday structure. Paper research only. PredictMarket can add context later. It does not place the trade.
        </p>
      </div>
      <MarketLensPanel
        replay={replay}
        error={error}
        summary={summary}
        days={days}
        runDays={runDays}
        chartCandles={chartCandles}
        chartDate={chartDate}
      />
    </div>
  );
}
