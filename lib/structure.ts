/**
 * Translate beat score + IV environment into a concrete options structure.
 */

import type { BeatScoreResult } from './beatScore';

export type SuggestedStructure = {
  action: 'SKIP' | 'CALL_DEBIT_SPREAD' | 'PUT_DEBIT_SPREAD' | 'LONG_CALL' | 'LONG_PUT' | 'IRON_CONDOR' | 'STRADDLE';
  rationale: string;
  legs?: Array<{
    side: 'BUY' | 'SELL';
    type: 'CALL' | 'PUT';
    strike: number;
    expiry: string;
  }>;
  notes: string[];
};

export type StructureInputs = {
  spot: number;
  ivRank: number;
  expectedMovePct: number;
  expectedMoveDollar: number;
  composite: number;
  signal: BeatScoreResult['signal'];
  preferredExpiry: string;
};

export function suggestStructure(inputs: StructureInputs): SuggestedStructure {
  const { spot, ivRank, expectedMoveDollar, composite, signal, preferredExpiry } = inputs;

  if (signal === 'SKIP') {
    return {
      action: 'SKIP',
      rationale: `Score ${composite} below threshold — no edge.`,
      notes: ['Wait for next setup. Don\'t force a trade.'],
    };
  }

  // High IV (>70 rank): use spreads or sell vol
  if (ivRank > 70) {
    if (signal === 'HIGH_CONVICTION') {
      // Bullish + high IV → call debit spread (defined risk, less vega)
      return {
        action: 'CALL_DEBIT_SPREAD',
        rationale: `High conviction (${composite}) but IV rank ${ivRank} is elevated. Spread limits IV crush exposure.`,
        legs: [
          {
            side: 'BUY',
            type: 'CALL',
            strike: roundStrike(spot),
            expiry: preferredExpiry,
          },
          {
            side: 'SELL',
            type: 'CALL',
            strike: roundStrike(spot + expectedMoveDollar),
            expiry: preferredExpiry,
          },
        ],
        notes: [
          'ATM long, OTM short at expected move',
          'Max profit if stock closes at short strike',
          'Defined risk = debit paid',
        ],
      };
    }

    return {
      action: 'CALL_DEBIT_SPREAD',
      rationale: `Moderate score (${composite}) with high IV. Spread is the prudent structure.`,
      legs: [
        {
          side: 'BUY',
          type: 'CALL',
          strike: roundStrike(spot),
          expiry: preferredExpiry,
        },
        {
          side: 'SELL',
          type: 'CALL',
          strike: roundStrike(spot + expectedMoveDollar * 0.75),
          expiry: preferredExpiry,
        },
      ],
      notes: ['Tighter spread, smaller premium, smaller risk'],
    };
  }

  // Low IV (<30 rank): cheap vol, buy directional
  if (ivRank < 30 && signal === 'HIGH_CONVICTION') {
    return {
      action: 'LONG_CALL',
      rationale: `High conviction (${composite}) AND low IV rank ${ivRank} = cheap directional bet.`,
      legs: [
        {
          side: 'BUY',
          type: 'CALL',
          strike: roundStrike(spot),
          expiry: preferredExpiry,
        },
      ],
      notes: [
        'IV likely to expand into print — vega works for you',
        'Size for total premium loss tolerance',
      ],
    };
  }

  // Default: directional with spread
  return {
    action: 'CALL_DEBIT_SPREAD',
    rationale: `Score ${composite} suggests directional bias with controlled risk.`,
    legs: [
      {
        side: 'BUY',
        type: 'CALL',
        strike: roundStrike(spot * 0.98),
        expiry: preferredExpiry,
      },
      {
        side: 'SELL',
        type: 'CALL',
        strike: roundStrike(spot + expectedMoveDollar),
        expiry: preferredExpiry,
      },
    ],
    notes: ['Slightly ITM long, OTM short at expected move'],
  };
}

function roundStrike(price: number): number {
  if (price < 25) return Math.round(price * 2) / 2; // 0.5 increments
  if (price < 200) return Math.round(price);
  return Math.round(price / 5) * 5; // $5 increments for high-priced names
}
