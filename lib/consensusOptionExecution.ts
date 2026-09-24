import type { ParsedTradePlan, TradeLeg, VerdictCall } from '@/lib/aiConsensus';
import type { OptionChain } from '@/lib/alpaca';
import { buildOccSymbol } from '@/lib/alpaca';

export type StructureLeg = {
  side: 'BUY' | 'SELL';
  type: 'CALL' | 'PUT';
  strike: number;
  expiry?: string;
};

export type ResolvedOptionLeg = {
  occSymbol: string;
  side: 'buy' | 'sell';
  strike: number;
  type: 'call' | 'put';
  expiry: string;
};

export type ResolvedOptionExecution = {
  tradeType: string | null;
  expiry: string;
  legs: ResolvedOptionLeg[];
};

/** Merge synthesis trade plan with brief suggested_structure when legs are missing. */
export function resolveTradeLegsForAutoTrade(
  verdict: VerdictCall,
  direction: 'UP' | 'DOWN',
  plan: ParsedTradePlan | null,
  suggestedStructure: { legs?: StructureLeg[]; preferredExpiry?: string; action?: string } | null,
): TradeLeg[] {
  const fromPlan = plan?.type && plan.type !== 'NONE' ? plan.legs : [];
  if (fromPlan.length > 0) return fromPlan;

  const fromBrief = suggestedStructure?.legs ?? [];
  if (fromBrief.length > 0) {
    return fromBrief.map(l => ({
      side: l.side,
      type: l.type,
      strike: l.strike,
    }));
  }

  if (verdict !== 'WATCH') return [];

  // Conservative WATCH fallback: single defined-risk directional leg at ATM.
  return [
    {
      side: 'BUY',
      type: direction === 'UP' ? 'CALL' : 'PUT',
      strike: 0,
    },
  ];
}

export function resolvePlanExpiry(
  plan: ParsedTradePlan | null,
  suggestedStructure: { preferredExpiry?: string } | null,
  chainExpiry: string,
): string {
  const raw = plan?.expiry?.trim() ?? suggestedStructure?.preferredExpiry?.trim() ?? '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  return chainExpiry;
}

/** Map abstract legs to OCC symbols using chain strikes (ATM when strike is 0). */
export function resolveOptionExecution(
  ticker: string,
  chain: OptionChain,
  tradeLegs: TradeLeg[],
  expiry: string,
): ResolvedOptionExecution | null {
  if (tradeLegs.length === 0) return null;

  const resolved: ResolvedOptionLeg[] = [];

  for (const leg of tradeLegs) {
    const type = leg.type.toLowerCase() as 'call' | 'put';
    const pool = type === 'call' ? chain.calls : chain.puts;
    if (!pool.length) return null;

    let strike = leg.strike;
    if (!strike || strike <= 0) {
      strike = pool.reduce(
        (best, c) =>
          Math.abs(c.strike - chain.spot) < Math.abs(best.strike - chain.spot) ? c : best,
        pool[0],
      ).strike;
    } else {
      const nearest = pool.reduce(
        (best, c) =>
          Math.abs(c.strike - strike) < Math.abs(best.strike - strike) ? c : best,
        pool[0],
      );
      strike = nearest.strike;
    }

    const match = pool.find(c => c.strike === strike && c.expiry === expiry);
    const occSymbol = match?.symbol ?? buildOccSymbol(ticker, expiry, type, strike);

    resolved.push({
      occSymbol,
      side: leg.side === 'BUY' ? 'buy' : 'sell',
      strike,
      type,
      expiry,
    });
  }

  return { tradeType: null, expiry, legs: resolved };
}

/** Estimated debit/credit per 1 spread or single contract (premium × 100). */
export function estimateOptionNotional(
  chain: OptionChain,
  legs: ResolvedOptionLeg[],
): number {
  let net = 0;
  for (const leg of legs) {
    const pool = leg.type === 'call' ? chain.calls : chain.puts;
    const row = pool.find(c => c.symbol === leg.occSymbol || c.strike === leg.strike);
    const mid = row?.mid ?? row?.ask ?? row?.bid ?? 0;
    net += leg.side === 'buy' ? mid : -mid;
  }
  return Math.max(0.05, Math.abs(net)) * 100;
}

export function formatLegSummary(legs: TradeLeg[]): string {
  return legs
    .map(l => `${l.side} ${l.type} $${l.strike > 0 ? l.strike : 'ATM'}`)
    .join(' · ');
}

export function canAutoTradeOptions(
  verdict: VerdictCall,
  tradeLegs: TradeLeg[],
): boolean {
  if (verdict === 'NO-GO') return false;
  if (verdict === 'GO') return tradeLegs.length > 0;
  return tradeLegs.length > 0;
}
