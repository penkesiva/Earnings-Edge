import type { AlpacaAuth } from '@/lib/alpaca';
import { lastUsEquityBacktestEndDate } from '@/lib/earningsDate';
import { aggregateBacktestMetrics } from '@/lib/intraday/backtest/metrics';
import { aggregateV2BacktestMetrics } from '@/lib/intraday/backtest/metricsV2';
import { fetchMinuteBarsForDay, listRecentTradingDates } from '@/lib/intraday/data/bars';
import { filterRegularSessionBars } from '@/lib/intraday/indicators/engine';
import {
  DEFAULT_EMA_TREND_DAY_V2_CONFIG,
  emaV2ConfigWithEntryMode,
} from '@/lib/intraday/strategies/emaTrendDayV2/config';
import { simulateEmaTrendDayV2 } from '@/lib/intraday/strategies/emaTrendDayV2/simulateDay';
import { simulateEmaTrendDay } from '@/lib/intraday/strategies/emaTrendDay/simulateDay';
import { DEFAULT_EMA_TREND_DAY_CONFIG } from '@/lib/intraday/config/defaults';
import type {
  BacktestMetricsExtended,
  BacktestTrade,
  EmaV2EntryMode,
  SignalLogEntry,
} from '@/lib/intraday/types';

export type MomentumSensitivityRow = {
  minMomentumScore: number;
  metrics: BacktestMetricsExtended;
};

export type EmaTrendCompareResult = {
  v1: BacktestMetricsExtended;
  v2Modes: Record<EmaV2EntryMode, BacktestMetricsExtended>;
  momentumSensitivity: MomentumSensitivityRow[];
  daysWithData: number;
  errors: string[];
};

const V2_MODES: EmaV2EntryMode[] = ['EMA_ONLY', 'EMA_REGIME', 'EMA_REGIME_MOMENTUM'];
const SENSITIVITY_THRESHOLDS = [50, 60, 70, 80] as const;

function runV2ModeOnDay(
  sessionDate: string,
  bars: import('@/lib/intraday/types').MinuteBar[],
  budget: number,
  mode: EmaV2EntryMode,
  minMomentumScore?: number,
) {
  const cfg = emaV2ConfigWithEntryMode(mode, {
    minMomentumScore: minMomentumScore ?? DEFAULT_EMA_TREND_DAY_V2_CONFIG.minMomentumScore,
  });
  return simulateEmaTrendDayV2(sessionDate, bars, budget, cfg);
}

export async function compareEmaTrendDayBacktest(input: {
  symbol: string;
  calendarDays: number;
  effectiveBudgetUsd: number;
  auth: AlpacaAuth;
}): Promise<EmaTrendCompareResult> {
  const end = lastUsEquityBacktestEndDate();
  const dates = listRecentTradingDates(end, input.calendarDays);
  const v1Trades: BacktestTrade[] = [];
  const modeTrades: Record<EmaV2EntryMode, BacktestTrade[]> = {
    EMA_ONLY: [],
    EMA_REGIME: [],
    EMA_REGIME_MOMENTUM: [],
  };
  const modeLogs: Record<EmaV2EntryMode, SignalLogEntry[]> = {
    EMA_ONLY: [],
    EMA_REGIME: [],
    EMA_REGIME_MOMENTUM: [],
  };
  const sensitivityTrades: Record<number, BacktestTrade[]> = {
    50: [],
    60: [],
    70: [],
    80: [],
  };
  const errors: string[] = [];
  let daysWithData = 0;

  for (const sessionDate of dates) {
    try {
      const raw = await fetchMinuteBarsForDay(input.symbol, sessionDate, input.auth);
      const bars = filterRegularSessionBars(raw, sessionDate);
      if (bars.length < 20) continue;
      daysWithData += 1;
      v1Trades.push(
        ...simulateEmaTrendDay(sessionDate, bars, input.effectiveBudgetUsd, DEFAULT_EMA_TREND_DAY_CONFIG)
          .trades,
      );
      for (const mode of V2_MODES) {
        const day = runV2ModeOnDay(sessionDate, bars, input.effectiveBudgetUsd, mode);
        modeTrades[mode].push(...day.trades);
        modeLogs[mode].push(...day.signalLog);
      }
      for (const th of SENSITIVITY_THRESHOLDS) {
        const day = runV2ModeOnDay(
          sessionDate,
          bars,
          input.effectiveBudgetUsd,
          'EMA_REGIME_MOMENTUM',
          th,
        );
        sensitivityTrades[th].push(...day.trades);
      }
    } catch (e) {
      errors.push(`${sessionDate}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  const cfg = DEFAULT_EMA_TREND_DAY_V2_CONFIG;
  const v2Modes = {} as Record<EmaV2EntryMode, BacktestMetricsExtended>;
  for (const mode of V2_MODES) {
    v2Modes[mode] = aggregateV2BacktestMetrics(
      modeTrades[mode],
      daysWithData,
      modeLogs[mode],
      cfg.slippageBps,
      cfg.commissionPerShare,
    );
  }

  const momentumSensitivity: MomentumSensitivityRow[] = SENSITIVITY_THRESHOLDS.map(th => ({
    minMomentumScore: th,
    metrics: aggregateV2BacktestMetrics(
      sensitivityTrades[th],
      daysWithData,
      [],
      cfg.slippageBps,
      cfg.commissionPerShare,
    ),
  }));

  return {
    v1: aggregateBacktestMetrics(v1Trades, daysWithData) as BacktestMetricsExtended,
    v2Modes,
    momentumSensitivity,
    daysWithData,
    errors: errors.slice(0, 8),
  };
}

export function formatCompareMetricsLine(label: string, m: BacktestMetricsExtended): string {
  return (
    `${label}: P&L $${m.totalPnlUsd.toFixed(2)}, ${m.trades} trades, WR ${m.winRate?.toFixed(1) ?? '—'}%, ` +
    `avg W $${m.avgWinnerUsd?.toFixed(2) ?? '—'}, avg L $${m.avgLoserUsd?.toFixed(2) ?? '—'}, ` +
    `PF ${m.profitFactor?.toFixed(2) ?? '—'}, exp $${m.expectancyPerTrade?.toFixed(2) ?? '—'}/tr, ` +
    `DD $${m.maxDrawdownUsd.toFixed(2)}, MFE $${m.avgMfeUsd?.toFixed(2) ?? '—'}, MAE $${m.avgMaeUsd?.toFixed(2) ?? '—'}`
  );
}
