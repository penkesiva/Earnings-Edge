import { INTRADAY_STRATEGY_VWAP_OR_V1 } from '@/lib/intraday/types';

export const INTRADAY_STRATEGIES = [
  {
    id: INTRADAY_STRATEGY_VWAP_OR_V1,
    label: 'VWAP + Opening Range Momentum',
    description:
      '15m opening range, VWAP pullback & OR breakout longs. Stocks only. Paper/live uses Trade Alpaca mode.',
  },
] as const;

export function strategyLabel(id: string): string {
  return INTRADAY_STRATEGIES.find(s => s.id === id)?.label ?? id;
}
