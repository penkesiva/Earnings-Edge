import type { PredictDirection, PredictTradeBias } from '@/lib/predictMarket/types';

export type PremarketPriceTarget = {
  targetSpx: number;
  side: 'PUT' | 'CALL';
  source: string;
};

function validSpx(n: number | null | undefined): number | null {
  if (n == null || !Number.isFinite(n) || n < 1000) return null;
  return Math.round(n * 100) / 100;
}

/** Locked at premarket: SPX level to touch in first 2h RTH (PUT = low target, CALL = high target). */
export function derivePremarketPriceTarget(input: {
  direction: PredictDirection | string;
  tradeBias: PredictTradeBias | string;
  expectedLow: number | null | undefined;
  expectedHigh: number | null | undefined;
  structured?: Record<string, unknown> | null;
}): PremarketPriceTarget | null {
  const structured = input.structured ?? {};
  const embedded = structured.price_target as
    | { target_spx?: number; side?: string }
    | undefined;
  if (embedded?.target_spx && embedded.side) {
    const t = validSpx(Number(embedded.target_spx));
    if (t && (embedded.side === 'PUT' || embedded.side === 'CALL')) {
      return { targetSpx: t, side: embedded.side, source: 'structured.price_target' };
    }
  }

  const bias = input.tradeBias;
  const dir = input.direction;

  if (bias === 'PUT' || (dir === 'RED' && bias !== 'CALL')) {
    const low = validSpx(input.expectedLow);
    if (low) return { targetSpx: low, side: 'PUT', source: 'expected_low' };
  }

  if (bias === 'CALL' || dir === 'GREEN') {
    const high = validSpx(input.expectedHigh);
    if (high) return { targetSpx: high, side: 'CALL', source: 'expected_high' };
  }

  return null;
}

export function evaluateTargetTouch(
  side: 'PUT' | 'CALL',
  targetSpx: number,
  windowLowSpx: number,
  windowHighSpx: number,
): boolean {
  if (side === 'PUT') return windowLowSpx <= targetSpx;
  return windowHighSpx >= targetSpx;
}

export function formatTargetLabel(targetSpx: number, side: 'PUT' | 'CALL'): string {
  const n = Math.round(targetSpx);
  return side === 'PUT' ? `T${n}↓` : `T${n}↑`;
}
