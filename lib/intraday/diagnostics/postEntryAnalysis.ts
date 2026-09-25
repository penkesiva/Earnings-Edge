import { barEtHHMM } from '@/lib/intraday/indicators/engine';
import { findBarIndexByTimeEt } from '@/lib/intraday/diagnostics/barIndex';
import type { BacktestTrade, MinuteBar } from '@/lib/intraday/types';

export type PostEntryAnalysis = {
  sessionDate: string;
  entryTimeEt: string;
  pnlUsd: number;
  return1m: number | null;
  return3m: number | null;
  return5m: number | null;
  return10m: number | null;
  return20m: number | null;
  return30m: number | null;
  mfePct: number;
  maePct: number;
  mfeUsd: number;
  maeUsd: number;
  timeToMfeMinutes: number | null;
  timeToMaeMinutes: number | null;
  behavior:
    | 'immediately_worked'
    | 'immediately_failed'
    | 'worked_then_reversed'
    | 'chopped_sideways'
    | 'sustained_trend'
    | 'mixed';
};

function forwardReturn(bars: MinuteBar[], entryIdx: number, entryPrice: number, minutes: number): number | null {
  const j = entryIdx + minutes;
  if (j >= bars.length) return null;
  return bars[j].c / entryPrice - 1;
}

function minutesBetween(entryEt: string, barEt: string): number {
  const toMin = (t: string) => {
    const [h, m] = t.split(':').map(Number);
    return h * 60 + m;
  };
  return toMin(barEt) - toMin(entryEt);
}

export function analyzePostEntry(
  bars: MinuteBar[],
  trade: BacktestTrade,
  shares: number,
): PostEntryAnalysis | null {
  const i = findBarIndexByTimeEt(bars, trade.entryTimeEt);
  if (i < 0) return null;
  const entryPrice = trade.entryPrice;

  let mfePct = 0;
  let maePct = 0;
  let mfeUsd = 0;
  let maeUsd = 0;
  let timeToMfe: number | null = null;
  let timeToMae: number | null = null;

  for (let j = i + 1; j < bars.length; j++) {
    const up = (bars[j].h - entryPrice) / entryPrice;
    const down = (entryPrice - bars[j].l) / entryPrice;
    if (up > mfePct) {
      mfePct = up;
      mfeUsd = (bars[j].h - entryPrice) * shares;
      timeToMfe = minutesBetween(trade.entryTimeEt, barEtHHMM(bars[j].t));
    }
    if (down > maePct) {
      maePct = down;
      maeUsd = (entryPrice - bars[j].l) * shares;
      timeToMae = minutesBetween(trade.entryTimeEt, barEtHHMM(bars[j].t));
    }
  }

  const r1 = forwardReturn(bars, i, entryPrice, 1);
  const r3 = forwardReturn(bars, i, entryPrice, 3);
  const r5 = forwardReturn(bars, i, entryPrice, 5);
  const r10 = forwardReturn(bars, i, entryPrice, 10);
  const r20 = forwardReturn(bars, i, entryPrice, 20);
  const r30 = forwardReturn(bars, i, entryPrice, 30);

  const behavior = classifyBehavior(trade.pnlUsd, r1, r3, r5, r10, r30, mfePct, maePct);

  return {
    sessionDate: trade.sessionDate,
    entryTimeEt: trade.entryTimeEt,
    pnlUsd: trade.pnlUsd,
    return1m: r1,
    return3m: r3,
    return5m: r5,
    return10m: r10,
    return20m: r20,
    return30m: r30,
    mfePct: mfePct * 100,
    maePct: maePct * 100,
    mfeUsd,
    maeUsd,
    timeToMfeMinutes: timeToMfe,
    timeToMaeMinutes: timeToMae,
    behavior,
  };
}

function classifyBehavior(
  pnlUsd: number,
  r1: number | null,
  r3: number | null,
  r5: number | null,
  r10: number | null,
  r30: number | null,
  mfePct: number,
  maePct: number,
): PostEntryAnalysis['behavior'] {
  const r1v = r1 ?? 0;
  const r5v = r5 ?? 0;
  const r30v = r30 ?? r5v;

  if (mfePct >= 0.015 && pnlUsd > 0 && (r10 ?? 0) > 0.005) return 'sustained_trend';
  if (r1v >= 0.0005 && r5v >= 0 && pnlUsd > 0) return 'immediately_worked';
  if (r1v <= -0.0005 && r5v <= 0) return 'immediately_failed';
  if ((r5 ?? 0) > 0.001 && pnlUsd < 0) return 'worked_then_reversed';
  if (Math.abs(r30v) < 0.0015 && mfePct < 0.008 && maePct < 0.008) return 'chopped_sideways';
  return 'mixed';
}
