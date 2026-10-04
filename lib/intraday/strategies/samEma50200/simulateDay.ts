import { applyLongExitPrice, applyLongFillPrice, commissionCost } from '@/lib/intraday/backtest/executionCost';
import { etHHMMToMinutes } from '@/lib/intraday/indicators/engine';
import { DEFAULT_SAM_EMA50_200_CONFIG } from '@/lib/intraday/strategies/samEma50200/config';
import {
  aggregateBars,
  atr,
  ema,
  macd,
  rsi,
  slopePct,
} from '@/lib/intraday/strategies/samEma50200/indicators';
import { sharesFromBudget } from '@/lib/intraday/sizing/computeShares';
import type {
  BacktestTrade,
  MinuteBar,
  SamEma50200Config,
  TradeExitReason,
} from '@/lib/intraday/types';

export type SamEma50200DayResult = { trades: BacktestTrade[] };

/**
 * SAM EMA 50/200 on N-minute bars. Indicators run over prior sessions + today so EMA200 is
 * valid at the open; trades only on `sessionDate`, always flat by `forceFlatEt`.
 */
export function simulateSamEma50200(
  sessionDate: string,
  bars: MinuteBar[],
  effectiveBudgetUsd: number,
  config: SamEma50200Config = DEFAULT_SAM_EMA50_200_CONFIG,
  priorBars: MinuteBar[] = [],
): SamEma50200DayResult {
  const trades: BacktestTrade[] = [];
  const series = aggregateBars([...priorBars, ...bars], config.barMinutes);
  const firstToday = series.findIndex(b => b.sessionDate === sessionDate);
  if (firstToday < 1) return { trades };

  const closes = series.map(b => b.c);
  const e50 = ema(closes, config.emaFast);
  const e200 = ema(closes, config.emaSlow);
  const m = macd(closes, config.macdFast, config.macdSlow, config.macdSignal);
  const r = rsi(closes, config.rsiPeriod);
  const a = atr(series, config.atrPeriod);

  const totalShares = sharesFromBudget(effectiveBudgetUsd, series[firstToday].c);
  if (!totalShares) return { trades };

  const firstEntry = etHHMMToMinutes(config.firstEntryEt);
  const noNewEntriesAfter = etHHMMToMinutes(config.noNewEntriesAfterEt);
  const forceFlat = etHHMMToMinutes(config.forceFlatEt);
  const L = config.slopeLookbackBars;

  let open = false;
  let entryPrice = 0;
  let entryTime = '';
  let stopPrice = 0;
  let reasons: string[] = [];
  let mfeUsd = 0;
  let maeUsd = 0;
  let roundTrips = 0;
  let cooldownUntil = 0;

  const close = (exitTime: string, rawExit: number, exitReason: TradeExitReason) => {
    let pnlUsd = (applyLongExitPrice(rawExit, config) - entryPrice) * totalShares;
    pnlUsd -= commissionCost(totalShares, config) * 2;
    trades.push({
      sessionDate,
      setupType: 'sam_ema50_200',
      entryTimeEt: entryTime,
      exitTimeEt: exitTime,
      entryPrice,
      exitPrice: rawExit,
      shares: totalShares,
      pnlUsd,
      pnlPct: entryPrice > 0 ? ((rawExit - entryPrice) / entryPrice) * 100 : 0,
      confidence: 70,
      reasons,
      exitReason,
      mfeUsd,
      maeUsd,
    });
    open = false;
  };

  for (let i = firstToday; i < series.length; i++) {
    const b = series[i];
    if (b.sessionDate !== sessionDate) continue;
    const tMin = etHHMMToMinutes(b.endEt);

    if (open) {
      mfeUsd = Math.max(mfeUsd, (b.h - entryPrice) * totalShares);
      maeUsd = Math.max(maeUsd, (entryPrice - b.l) * totalShares);

      let exit: { price: number; reason: TradeExitReason } | null = null;
      if (b.l <= stopPrice) {
        exit = { price: Math.min(b.o, stopPrice), reason: 'stop' };
      } else if (Number.isFinite(e50[i]) && b.c < e50[i]) {
        exit = { price: b.c, reason: 'ema50_close' };
      } else if (
        m.line[i - 1] >= m.signal[i - 1] &&
        m.line[i] < m.signal[i] &&
        b.c > entryPrice
      ) {
        exit = { price: b.c, reason: 'macd_cross_down' };
      } else if (tMin >= forceFlat) {
        exit = { price: b.c, reason: 'eod_flat' };
      }

      if (exit) {
        close(b.endEt, exit.price, exit.reason);
        roundTrips += 1;
        cooldownUntil = i + config.cooldownBars + 1;
      }
      continue;
    }

    if (tMin < firstEntry || tMin > noNewEntriesAfter) continue;
    if (roundTrips >= config.maxTradesPerDay || i < cooldownUntil) continue;

    const slopeNow = slopePct(e50, i, L);
    const slopePrev = slopePct(e50, i - L, L);
    const values = [e50[i], e200[i], slopeNow, slopePrev, m.hist[i], m.hist[i - 1], r[i], r[i - 1], a[i]];
    if (!values.every(Number.isFinite)) continue;

    const trend = b.c > e50[i] && e50[i] > e200[i];
    const sharpRise = slopeNow >= config.minEma50SlopePct && slopeNow > slopePrev;
    const macdOk = m.line[i] > m.signal[i] && m.hist[i] > m.hist[i - 1];
    const rsiOk = r[i] > config.rsiMin && r[i] < config.rsiMax && r[i] > r[i - 1];
    if (!trend || !sharpRise || !macdOk || !rsiOk) continue;

    entryPrice = applyLongFillPrice(b.c, config);
    entryTime = b.endEt;
    stopPrice = entryPrice - config.atrStopMult * a[i];
    mfeUsd = 0;
    maeUsd = 0;
    reasons = [
      `close ${b.c.toFixed(2)} > EMA50 ${e50[i].toFixed(2)} > EMA200 ${e200[i].toFixed(2)}`,
      `EMA50 slope ${slopeNow.toFixed(3)}% (prev ${slopePrev.toFixed(3)}%)`,
      `MACD hist ${m.hist[i].toFixed(4)} rising`,
      `RSI ${r[i].toFixed(1)} rising`,
      `stop ${stopPrice.toFixed(2)} (${config.atrStopMult}x ATR ${a[i].toFixed(3)})`,
    ];
    open = true;
  }

  if (open) {
    const last = series[series.length - 1];
    close(last.endEt, last.c, 'session_end');
  }

  return { trades };
}
