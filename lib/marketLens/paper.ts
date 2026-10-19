import type { ClosedTrade } from '@/lib/marketLens/types';

/**
 * The order a later Alpaca paper mode would send. This function does not
 * call Alpaca and cannot submit a live order.
 */
export type PaperOrderPlan = {
  mode: 'PAPER_ONLY';
  symbol: 'SPY';
  side: 'buy' | 'sell';
  qty: 1;
  type: 'market';
  time_in_force: 'day';
  stop_price: number;
  target_price: number;
  note: string;
};

export function planPaperOrder(trade: ClosedTrade): PaperOrderPlan {
  return {
    mode: 'PAPER_ONLY',
    symbol: 'SPY',
    side: trade.side === 'long' ? 'buy' : 'sell',
    qty: 1,
    type: 'market',
    time_in_force: 'day',
    stop_price: Number(trade.stop.toFixed(2)),
    target_price: Number(trade.target.toFixed(2)),
    note: `${trade.setup} paper plan. Not sent.`,
  };
}
