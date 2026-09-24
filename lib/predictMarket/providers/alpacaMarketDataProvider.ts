import { getStockSnapshot, type AlpacaAuth } from '@/lib/alpaca';
import type { MarketDataProvider, MarketDataBundle, MarketSnapshotInput } from '@/lib/predictMarket/providers/types';

const INDEX_PROXIES: Record<string, string> = {
  spx: 'SPY',
  es: 'SPY',
  nq: 'QQQ',
};

/** Phase 1: Alpaca snapshots for tradable proxies; null where unavailable. */
export class AlpacaMarketDataProvider implements MarketDataProvider {
  async collect(session: MarketSnapshotInput, auth?: AlpacaAuth | null): Promise<MarketDataBundle> {
    const missing: string[] = [];
    const read = async (symbol: string) => {
      try {
        const snap = await getStockSnapshot(symbol, auth);
        return snap;
      } catch {
        missing.push(symbol);
        return null;
      }
    };

    const spy = await read(INDEX_PROXIES.spx);
    const qqq = await read(INDEX_PROXIES.nq);

    const spxPrice = spy?.price ?? null;
    const prevClose = spy?.prevClose ?? null;

    return {
      provenance: 'ACTUAL',
      spx: { price: spxPrice, previousClose: prevClose },
      es: {
        price: spy?.price ?? null,
        changePct: spy?.pctChange ?? null,
      },
      nq: {
        price: qqq?.price ?? null,
        changePct: qqq?.pctChange ?? null,
      },
      vix: { level: null, changePct: null },
      treasuries: {
        y2: null,
        y10: null,
        y30: null,
        spread10y2y: null,
      },
      dxy: { level: null, changePct: null },
      technical: {
        previous_close: prevClose,
        distance_from_previous_close_pct:
          spxPrice != null && prevClose ? ((spxPrice - prevClose) / prevClose) * 100 : null,
      },
      missing: [
        ...missing,
        'VIX',
        'Treasuries',
        'DXY',
        'Commodities',
        'Global indices',
        'Breadth',
      ],
    };
  }
}

export const defaultMarketDataProvider: MarketDataProvider = new AlpacaMarketDataProvider();
