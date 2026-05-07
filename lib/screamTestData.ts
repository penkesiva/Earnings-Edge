/**
 * Build ScreamTestInputs from Alpaca option chain + fundamentals context.
 */

import type { OptionChain } from './alpaca';
import type { ScreamTestInputs } from './screamTest';

export type ChainScreamFields = Pick<
  ScreamTestInputs,
  | 'nearMoneyCallVol'
  | 'nearMoneyPutVol'
  | 'largestOiCluster'
  | 'largestOiSide'
  | 'iv25dCall'
  | 'iv25dPut'
>;

/** Volume + OI skew within ±5% of spot; IV at ~25Δ if greeks exist. */
export function deriveChainScreamFields(chain: OptionChain): ChainScreamFields {
  const spot = chain.spot || 1;
  const lo = spot * 0.95;
  const hi = spot * 1.05;

  let nearMoneyCallVol = 0;
  let nearMoneyPutVol = 0;
  let largestOiCluster = 0;
  let largestOiSide: 'call' | 'put' = 'call';

  for (const c of chain.calls) {
    if (c.strike >= lo && c.strike <= hi) nearMoneyCallVol += c.volume ?? 0;
    const oi = c.openInterest ?? 0;
    if (oi > largestOiCluster) {
      largestOiCluster = oi;
      largestOiSide = 'call';
    }
  }

  for (const p of chain.puts) {
    if (p.strike >= lo && p.strike <= hi) nearMoneyPutVol += p.volume ?? 0;
    const oi = p.openInterest ?? 0;
    if (oi > largestOiCluster) {
      largestOiCluster = oi;
      largestOiSide = 'put';
    }
  }

  const callsPosDelta = chain.calls.filter(c => c.delta > 0.05 && c.delta < 0.95);
  const call25 = callsPosDelta.reduce<(typeof chain.calls)[0] | null>((best, c) => {
    if (!best || Math.abs(c.delta - 0.25) < Math.abs(best.delta - 0.25)) return c;
    return best;
  }, null);

  const putsNegDelta = chain.puts.filter(p => p.delta < -0.05 && p.delta > -0.95);
  const put25 = putsNegDelta.reduce<(typeof chain.puts)[0] | null>((best, p) => {
    const ad = Math.abs(p.delta);
    if (!best || Math.abs(ad - 0.25) < Math.abs(Math.abs(best.delta) - 0.25)) return p;
    return best;
  }, null);

  const iv25dCall =
    call25 && call25.iv > 0 ? call25.iv : chain.calls.length ? averageIvNearSpot(chain.calls, spot) : null;
  const iv25dPut =
    put25 && put25.iv > 0 ? put25.iv : chain.puts.length ? averageIvNearSpot(chain.puts, spot) : null;

  return {
    nearMoneyCallVol,
    nearMoneyPutVol,
    largestOiCluster,
    largestOiSide,
    iv25dCall,
    iv25dPut,
  };
}

function averageIvNearSpot(contracts: { strike: number; iv: number }[], spot: number): number | null {
  const near = contracts.filter(
    c => c.iv > 0 && Math.abs(c.strike - spot) / spot <= 0.05
  );
  if (!near.length) return null;
  const sum = near.reduce((a, c) => a + c.iv, 0);
  return sum / near.length;
}

/** YTD % from Alpaca daily bars (close-based). */
export function ytdReturnPctFromBars(
  bars: { t: string; c: number }[],
  year = new Date().getFullYear()
): number {
  const prefix = `${year}-`;
  const ytd = bars.filter(b => String(b.t).startsWith(prefix));
  if (ytd.length < 2) return 0;
  const first = ytd[0].c;
  const last = ytd[ytd.length - 1].c;
  if (!first) return 0;
  return ((last - first) / first) * 100;
}
