type ExecutionCostConfig = { slippageBps: number; commissionPerShare: number };

export function applyLongFillPrice(price: number, config: ExecutionCostConfig): number {
  return price * (1 + config.slippageBps / 10_000);
}

export function applyLongExitPrice(price: number, config: ExecutionCostConfig): number {
  return price * (1 - config.slippageBps / 10_000);
}

export function commissionCost(shares: number, config: ExecutionCostConfig): number {
  return shares * config.commissionPerShare;
}
