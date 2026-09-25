import { IntradayPanel } from '@/components/intraday/IntradayPanel';
import { loadIntradayPageData } from '@/lib/intradayPageActions';

export const dynamic = 'force-dynamic';

export default async function IntradayPage() {
  const data = await loadIntradayPageData();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl sm:text-3xl font-bold tracking-tight mb-2">
          <span className="page-chevron">›</span> INTRADAY
        </h1>
        <p className="text-sm text-fg-subtle max-w-2xl">
          Rules-based stock strategies — backtest first, then paper or live via Trade Alpaca mode.
          One symbol at a time.
        </p>
      </div>
      <IntradayPanel
        migrationRequired={data.migrationRequired}
        strategies={data.strategies}
        settings={data.settings as Record<string, unknown> | null}
        runs={(data.runs ?? []) as Parameters<typeof IntradayPanel>[0]['runs']}
        liveTradingEnabled={data.liveTradingEnabled}
        paperConfigured={data.paperConfigured}
      />
    </div>
  );
}
