import { TradeAutomationPanel } from '@/components/trade/TradeAutomationPanel';
import { loadTradePageData } from '@/lib/tradePageActions';
import Link from 'next/link';

export const dynamic = 'force-dynamic';

export default async function TradePage() {
  const { settings, candidates, orders, paperConfigured, migrationRequired } =
    await loadTradePageData();

  return (
    <div className="space-y-8 max-w-3xl">
      <div>
        <h1 className="text-2xl sm:text-3xl font-bold tracking-tight mb-2">
          <span className="page-chevron">›</span> TRADE
        </h1>
        <p className="text-sm text-fg-subtle">
          Auto-trade consensus GO signals on your watchlist — paper by default
        </p>
      </div>

      {migrationRequired ? (
        <div className="border border-signal-watch/40 bg-signal-watch/5 px-4 py-3 text-sm text-fg-subtle">
          Run <code className="font-mono text-xs">0019_automation_trade.sql</code> in the
          Supabase SQL editor to enable auto-trade. See{' '}
          <Link href="/status" className="text-accent underline underline-offset-2">
            Status
          </Link>{' '}
          for the full migration list.
        </div>
      ) : null}

      <TradeAutomationPanel
        settings={settings}
        candidates={candidates}
        orders={orders}
        paperConfigured={paperConfigured}
        migrationRequired={migrationRequired}
      />
    </div>
  );
}
