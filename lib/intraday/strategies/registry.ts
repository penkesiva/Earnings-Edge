import {
  INTRADAY_STRATEGY_BUY_WEAK_SELL_STRONG_V1,
  INTRADAY_STRATEGY_EMA_TREND_DAY_V1,
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
] as const;

export function strategyLabel(id: string): string {
  return INTRADAY_STRATEGIES.find(s => s.id === id)?.label ?? id;
}
