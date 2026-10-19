import { MarketLensPanel } from '@/components/marketLens/MarketLensPanel';
import { replaySavedSession } from '@/lib/marketLens/backtest';
import { lastCompletedSessionDate } from '@/lib/marketLens/sessionTime';

export const dynamic = 'force-dynamic';

export default async function MarketLensPage() {
  const sessionDate = lastCompletedSessionDate();
  let replay = null;
  let error: string | null = null;
  try {
    replay = await replaySavedSession(sessionDate);
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
      <MarketLensPanel replay={replay} error={error} />
    </div>
  );
}
