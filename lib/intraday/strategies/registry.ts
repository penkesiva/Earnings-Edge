import {
  INTRADAY_STRATEGY_BUY_WEAK_SELL_STRONG_V1,
  INTRADAY_STRATEGY_EMA_TREND_DAY_V1,
  INTRADAY_STRATEGY_EMA_TREND_DAY_V2,
  INTRADAY_STRATEGY_TREND_RESUMPTION_V1_CONFIRMED,
  INTRADAY_STRATEGY_TREND_RESUMPTION_V1_EARLY,
  INTRADAY_STRATEGY_VWAP_OR_V1,
} from '@/lib/intraday/types';

export const INTRADAY_STRATEGIES = [
  {
    id: INTRADAY_STRATEGY_VWAP_OR_V1,
    label: 'VWAP + Opening Range Momentum',
    description:
      '15m opening range, VWAP pullback & OR breakout longs. Stops + targets. Long-only.',
  },
  {
    id: INTRADAY_STRATEGY_BUY_WEAK_SELL_STRONG_V1,
    label: 'Buy Weak · Sell Strong',
    description:
      'Buy dips below VWAP; exit on strength (profit only). No stop — hold red until rip or 3:50 PM ET flat.',
  },
  {
    id: INTRADAY_STRATEGY_EMA_TREND_DAY_V1,
    label: '9/20 EMA Trend Day',
    description:
      'Session 9 & 20 EMA from RTH bars. Long on bull cross or pullback to 9 EMA; exit on 9 cross below 20 or EOD flat.',
  },
  {
    id: INTRADAY_STRATEGY_EMA_TREND_DAY_V2,
    label: '9/20 EMA Trend Day v2 (experimental)',
    description:
      'Regime filter (BULL/CHOP), VWAP + volume + score, pullback zone, structural stop, profit giveback. Baseline config — compare vs v1.',
  },
  {
    id: INTRADAY_STRATEGY_TREND_RESUMPTION_V1_EARLY,
    label: 'Trend Resumption v1 · Early',
    description:
      'Experimental: enter on BUILDING momentum after VWAP/EMA reset. Avoids EXTENDED chase. Compare vs EMA v1/v2.',
  },
  {
    id: INTRADAY_STRATEGY_TREND_RESUMPTION_V1_CONFIRMED,
    label: 'Trend Resumption v1 · Confirmed',
    description:
      'Experimental: wait for BUILDING → EXPANDING before entry after reset. Same exits as Early variant.',
  },
] as const;

export function strategyLabel(id: string): string {
  return INTRADAY_STRATEGIES.find(s => s.id === id)?.label ?? id;
}
