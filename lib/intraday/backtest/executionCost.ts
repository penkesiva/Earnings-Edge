import type { EmaTrendDayV2Config } from '@/lib/intraday/types';

export function applyLongFillPrice(price: number, config: EmaTrendDayV2Config): number {
  return price * (1 + config.slippageBps / 10_000);
}

export function applyLongExitPrice(price: number, config: EmaTrendDayV2Config): number {
  return price * (1 - config.slippageBps / 10_000);
}

export function commissionCost(shares: number, config: EmaTrendDayV2Config): number {
  return shares * config.commissionPerShare;
}
