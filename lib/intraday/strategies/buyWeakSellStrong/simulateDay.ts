import { barEtHHMM, computeSessionIndicators, etHHMMToMinutes } from '@/lib/intraday/indicators/engine';
import { sharesFromBudget } from '@/lib/intraday/sizing/computeShares';
import type { BacktestTrade, BuyWeakStrategyConfig, MinuteBar, SetupType } from '@/lib/intraday/types';

type SimResult = { trades: BacktestTrade[] };

/**
 * Long-only mean reversion: buy weakness below VWAP, exit on strength (profit only).
 * No stop-loss — hold red until rip or EOD force flat.
 */
export function simulateBuyWeakSellStrongDay(
  sessionDate: string,
  bars: MinuteBar[],
  effectiveBudgetUsd: number,
  config: BuyWeakStrategyConfig,
): SimResult {
  const trades: BacktestTrade[] = [];
  if (bars.length < config.openingRangeMinutes + 5) return { trades };

  const ind = computeSessionIndicators(bars);
  const refPrice = bars[config.openingRangeMinutes]?.c ?? 0;
  const totalShares = sharesFromBudget(effectiveBudgetUsd, refPrice);
  if (!totalShares) return { trades };

  let state: 'flat' | 'open' = 'flat';
  let entryPrice = 0;
  let entryTime = '';
  let entrySetup: SetupType = 'vwap_dip';
  let sharesHeld = 0;
  let roundTrips = 0;
  let cooldownUntilIdx = 0;
  let reasons: string[] = [];
  let confidence = 0;

  const noNewEntriesAfter = etHHMMToMinutes(config.noNewEntriesAfterEt);
  const forceFlatAfter = etHHMMToMinutes(config.forceFlatEt);

  for (let i = config.openingRangeMinutes; i < bars.length; i++) {
    const b = bars[i];
    const t = barEtHHMM(b.t);
    const tMin = etHHMMToMinutes(t);
    const vwap = ind.vwap[i];
    const e9 = ind.ema9[i];
    if (!Number.isFinite(vwap) || vwap <= 0) continue;

    if (state === 'open' && tMin >= forceFlatAfter) {
      trades.push(
        closeTrade(
          sessionDate,
          entrySetup,
          entryTime,
          t,
          entryPrice,
          b.c,
          sharesHeld,
          reasons,
          confidence,
          'eod_flat',
        ),
      );
      state = 'flat';
      break;
    }

    if (state === 'open') {
      const pnlPct = ((b.c - entryPrice) / entryPrice) * 100;
      if (pnlPct <= 0) continue;

      const ripTarget = entryPrice * (1 + config.minProfitExitPct / 100);
      const aboveVwap = b.c >= vwap;
      const hitRip = b.h >= ripTarget || pnlPct >= config.minProfitExitPct;
      const vwapRip = config.ripExitAboveVwap && aboveVwap && pnlPct >= config.minProfitExitPct * 0.5;

      if (hitRip || vwapRip) {
        trades.push(
          closeTrade(
            sessionDate,
            entrySetup,
            entryTime,
            t,
            entryPrice,
            b.c,
            sharesHeld,
            reasons,
            confidence,
            'strength',
          ),
        );
        state = 'flat';
        cooldownUntilIdx = i + config.cooldownMinutes;
        roundTrips += 1;
      }
      continue;
    }

    if (i < cooldownUntilIdx) continue;
    if (tMin >= noNewEntriesAfter) continue;
    if (roundTrips >= config.maxTradesPerDay) continue;

    const setup = detectWeakEntry(bars, i, vwap, e9, ind.ema20[i], config);
    if (!setup || setup.confidence < config.minConfidence) continue;

    entrySetup = setup.type;
    reasons = setup.reasons;
    confidence = setup.confidence;
    entryPrice = b.c;
    entryTime = t;
    sharesHeld = totalShares;
    state = 'open';
  }

  if (state === 'open' && bars.length > 0) {
    const last = bars[bars.length - 1];
    const exitT = barEtHHMM(last.t);
    const exitMin = etHHMMToMinutes(exitT);
    trades.push(
      closeTrade(
        sessionDate,
        entrySetup,
        entryTime,
        exitT,
        entryPrice,
        last.c,
        sharesHeld,
        reasons,
        confidence,
        exitMin >= forceFlatAfter ? 'eod_flat' : 'session_end',
      ),
    );
  }

  return { trades };
}

function detectWeakEntry(
  bars: MinuteBar[],
  i: number,
  vwap: number,
  e9: number,
  e20: number,
  config: BuyWeakStrategyConfig,
): { type: SetupType; reasons: string[]; confidence: number } | null {
  const b = bars[i];
  const prev = bars[i - 1];
  const dipPct = ((vwap - b.c) / vwap) * 100;
  if (dipPct < config.dipBelowVwapPct) return null;

  const reasons: string[] = [`${dipPct.toFixed(2)}% below VWAP`];
  let score = 50;

  if (b.c < e9) {
    score += 10;
    reasons.push('below 9 EMA');
  }
  if (e9 <= e20) {
    score += 10;
    reasons.push('short-term weak vs 20 EMA');
  }
  if (b.c <= prev.c) {
    score += 5;
    reasons.push('down bar');
  }

  const type: SetupType = dipPct >= config.dipBelowVwapPct * 2 ? 'deep_dip' : 'vwap_dip';
  if (type === 'deep_dip') {
    score += 10;
    reasons.push('extended dip');
  }

  return { type, reasons, confidence: Math.min(100, score) };
}

function closeTrade(
  sessionDate: string,
  setupType: SetupType,
  entryTimeEt: string,
  exitTimeEt: string,
  entryPrice: number,
  exitPrice: number,
  shares: number,
  reasons: string[],
  confidence: number,
  exitReason: BacktestTrade['exitReason'],
): BacktestTrade {
  const pnlUsd = (exitPrice - entryPrice) * shares;
  const pnlPct = entryPrice > 0 ? ((exitPrice - entryPrice) / entryPrice) * 100 : 0;
  return {
    sessionDate,
    setupType,
    entryTimeEt,
    exitTimeEt,
    entryPrice,
    exitPrice,
    shares,
    pnlUsd,
    pnlPct,
    confidence,
    reasons,
    exitReason,
  };
}
