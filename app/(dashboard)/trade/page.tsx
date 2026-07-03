import { TradeAutomationPanel } from '@/components/trade/TradeAutomationPanel';
import { loadTradePageData } from '@/app/(dashboard)/trade/actions';

export const dynamic = 'force-dynamic';

export default async function TradePage() {
  const { settings, candidates, orders, paperConfigured } = await loadTradePageData();

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

      <TradeAutomationPanel
        settings={settings}
        candidates={candidates}
        orders={orders}
        paperConfigured={paperConfigured}
      />
    </div>
  );
}
