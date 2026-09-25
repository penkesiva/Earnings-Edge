import type { AlpacaAuth } from '@/lib/alpaca';
import { lastUsEquityBacktestEndDate } from '@/lib/earningsDate';
import {
  aggregateTrendResumptionMetrics,
  type TrendResumptionCompareMetrics,
} from '@/lib/intraday/backtest/metricsTrendResumption';
import { fetchMinuteBarsForDay, listRecentTradingDates } from '@/lib/intraday/data/bars';
import { findBarIndexByTimeEt } from '@/lib/intraday/diagnostics/barIndex';
import { bollingerAtBar } from '@/lib/intraday/diagnostics/bollingerAtBar';
import { filterRegularSessionBars } from '@/lib/intraday/indicators/engine';
import { buildBarContexts } from '@/lib/intraday/strategies/emaTrendDayV2/indicators';
import { distVwapPct } from '@/lib/intraday/strategies/trendResumptionV1/resumption';
import { simulateStrategyDay } from '@/lib/intraday/strategies/runStrategyDay';
import {
  INTRADAY_STRATEGY_EMA_TREND_DAY_V1,
  INTRADAY_STRATEGY_EMA_TREND_DAY_V2,
  INTRADAY_STRATEGY_TREND_RESUMPTION_V1_CONFIRMED,
  INTRADAY_STRATEGY_TREND_RESUMPTION_V1_EARLY,
  type BacktestTrade,
} from '@/lib/intraday/types';
import type { MinuteBar } from '@/lib/intraday/types';

export type TrendResumptionHorizonRow = {
  calendarDays: number;
  daysWithData: number;
  emaV1: TrendResumptionCompareMetrics;
  emaV2: TrendResumptionCompareMetrics;
  resumptionEarly: TrendResumptionCompareMetrics;
  resumptionConfirmed: TrendResumptionCompareMetrics;
};

export type TrendResumptionCompareResult = {
  symbol: string;
  horizons: TrendResumptionHorizonRow[];
  errors: string[];
};

const STRATEGY_IDS = {
  emaV1: INTRADAY_STRATEGY_EMA_TREND_DAY_V1,
  emaV2: INTRADAY_STRATEGY_EMA_TREND_DAY_V2,
  resumptionEarly: INTRADAY_STRATEGY_TREND_RESUMPTION_V1_EARLY,
  resumptionConfirmed: INTRADAY_STRATEGY_TREND_RESUMPTION_V1_CONFIRMED,
} as const;

const HORIZONS = [30, 90, 180] as const;

function timeBucket(entryTimeEt: string): string {
  const [h, m] = entryTimeEt.split(':').map(Number);
  const mins = h * 60 + m;
  if (mins < 10 * 60 + 30) return 'open';
  if (mins < 12 * 60) return 'mid_morning';
  if (mins < 14 * 60) return 'midday';
  return 'afternoon';
}

function enrichTrades(trades: BacktestTrade[], barsBySession: Map<string, MinuteBar[]>) {
  return trades.map(t => {
    const bars = barsBySession.get(t.sessionDate);
    if (!bars) {
      return { trade: t, distVwap: 0, percentB: null as number | null, timeBucket: timeBucket(t.entryTimeEt) };
    }
    const i = findBarIndexByTimeEt(bars, t.entryTimeEt);
    if (i < 0) {
      return { trade: t, distVwap: 0, percentB: null, timeBucket: timeBucket(t.entryTimeEt) };
    }
    const ctx = buildBarContexts(bars)[i];
    const bb = bollingerAtBar(bars, i);
    return {
      trade: t,
      distVwap: distVwapPct(bars[i], ctx),
      percentB: bb?.percentB ?? null,
      timeBucket: timeBucket(t.entryTimeEt),
    };
  });
}

async function runHorizon(
  symbol: string,
  calendarDays: number,
  budget: number,
  auth: AlpacaAuth,
): Promise<Omit<TrendResumptionHorizonRow, 'calendarDays'>> {
  const end = lastUsEquityBacktestEndDate();
  const dates = listRecentTradingDates(end, calendarDays);
  const barsBySession = new Map<string, MinuteBar[]>();
  let daysWithData = 0;

  for (const sessionDate of dates) {
    const raw = await fetchMinuteBarsForDay(symbol, sessionDate, auth);
    const bars = filterRegularSessionBars(raw, sessionDate);
    if (bars.length < 20) continue;
    daysWithData += 1;
    barsBySession.set(sessionDate, bars);
  }

  const metrics = {} as Omit<TrendResumptionHorizonRow, 'calendarDays' | 'daysWithData'>;
  for (const [key, strategyId] of Object.entries(STRATEGY_IDS) as [keyof typeof STRATEGY_IDS, string][]) {
    const allTrades: BacktestTrade[] = [];
    for (const sessionDate of dates) {
      const bars = barsBySession.get(sessionDate);
      if (!bars) continue;
      allTrades.push(...simulateStrategyDay(strategyId, sessionDate, bars, budget).trades);
    }
    metrics[key] = aggregateTrendResumptionMetrics(
      allTrades,
      daysWithData,
      enrichTrades(allTrades, barsBySession),
    );
  }

  return { daysWithData, ...metrics };
}

export async function compareTrendResumptionBacktest(input: {
  symbol: string;
  effectiveBudgetUsd: number;
  auth: AlpacaAuth;
}): Promise<TrendResumptionCompareResult> {
  const horizons: TrendResumptionHorizonRow[] = [];
  const errors: string[] = [];

  for (const calendarDays of HORIZONS) {
    try {
      const row = await runHorizon(input.symbol, calendarDays, input.effectiveBudgetUsd, input.auth);
      horizons.push({ calendarDays, ...row });
    } catch (e) {
      errors.push(`${calendarDays}d: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  return { symbol: input.symbol, horizons, errors };
}

export function formatTrendResumptionCompare(r: TrendResumptionCompareResult): string {
  const lines: string[] = [
    `Trend resumption compare — ${r.symbol}`,
    'Hypothesis: enter on momentum resumption after reset, not extended chase.',
    'No threshold optimization — baseline params only.',
    '',
  ];
  for (const h of r.horizons) {
    lines.push(`=== ${h.calendarDays} calendar days (${h.daysWithData} sessions) ===`);
    for (const label of ['emaV1', 'emaV2', 'resumptionEarly', 'resumptionConfirmed'] as const) {
      const m = h[label];
      lines.push(
        `${label}: ${m.trades} tr | P&L $${m.totalPnlUsd.toFixed(2)} | WR ${m.winRate?.toFixed(1) ?? '—'}% | PF ${m.profitFactor?.toFixed(2) ?? '—'} | exp $${m.expectancyPerTrade?.toFixed(2) ?? '—'} | DD $${m.maxDrawdownUsd.toFixed(2)} | hold ${m.avgHoldMinutes?.toFixed(0) ?? '—'}m | avg MFE $${m.avgMfeUsd?.toFixed(2) ?? '—'} | med MFE $${m.medianMfeUsd?.toFixed(2) ?? '—'} | avg MAE $${m.avgMaeUsd?.toFixed(2) ?? '—'} | med MAE $${m.medianMaeUsd?.toFixed(2) ?? '—'}`,
      );
      lines.push(`  bySetup: ${JSON.stringify(m.bySetup)}`);
      lines.push(`  vwapBuckets: ${JSON.stringify(m.vwapBuckets)}`);
      lines.push(`  percentB: ${JSON.stringify(m.percentBBuckets)}`);
      lines.push(`  timeOfDay: ${JSON.stringify(m.timeBuckets)}`);
    }
    lines.push('');
  }
  if (r.errors.length) lines.push('Errors:', ...r.errors.map(e => `- ${e}`));
  return lines.join('\n');
}
