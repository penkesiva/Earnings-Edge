import type { AlpacaAuth } from '@/lib/alpaca';
import { lastUsEquityBacktestEndDate } from '@/lib/earningsDate';
import { aggregateV2BacktestMetrics } from '@/lib/intraday/backtest/metricsV2';
import { findBarIndexByTimeEt } from '@/lib/intraday/diagnostics/barIndex';
import { FORENSICS_VARIANTS } from '@/lib/intraday/diagnostics/delayedEntryGate';
import {
  avgForensics,
  buildEntryForensics,
  COMPARE_NUMERIC_KEYS,
  type EntryForensicsRow,
} from '@/lib/intraday/diagnostics/entryForensics';
import { analyzePostEntry, type PostEntryAnalysis } from '@/lib/intraday/diagnostics/postEntryAnalysis';
import { replayPullbackMomentumTimeline } from '@/lib/intraday/diagnostics/pullbackMomentumTimeline';
import {
  analyzeAcceptedForward,
  analyzeRejections,
  type RejectionBucketStats,
} from '@/lib/intraday/diagnostics/rejectionAnalysis';
import { fetchMinuteBarsForDay, listRecentTradingDates } from '@/lib/intraday/data/bars';
import { filterRegularSessionBars } from '@/lib/intraday/indicators/engine';
import { DEFAULT_EMA_TREND_DAY_V2_CONFIG } from '@/lib/intraday/strategies/emaTrendDayV2/config';
import { buildBarContexts } from '@/lib/intraday/strategies/emaTrendDayV2/indicators';
import { simulateEmaTrendDayV2 } from '@/lib/intraday/strategies/emaTrendDayV2/simulateDay';
import type {
  BacktestMetricsExtended,
  BacktestTrade,
  ForensicsDelayedEntryVariant,
  SignalLogEntry,
} from '@/lib/intraday/types';
import type { MinuteBar } from '@/lib/intraday/types';
import { formatForensicsMarkdown } from '@/lib/intraday/diagnostics/formatForensicsReport';

export type VariantSimRow = {
  variant: ForensicsDelayedEntryVariant;
  candidateTrades: number;
  executedTrades: number;
  metrics: BacktestMetricsExtended;
};

export type EmaV2ForensicsReport = {
  symbol: string;
  calendarDays: number;
  daysWithData: number;
  summaryMetrics: BacktestMetricsExtended;
  rejectedSignalCount: number;
  entryForensics: EntryForensicsRow[];
  postEntry: PostEntryAnalysis[];
  winnerRow: EntryForensicsRow | null;
  loserRows: EntryForensicsRow[];
  compareTable: { feature: string; winner: string; avgLoser: string; diff: string }[];
  momentumTimelines: ReturnType<typeof replayPullbackMomentumTimeline>[];
  variantSims: VariantSimRow[];
  rejectionBuckets: RejectionBucketStats[];
  acceptedForward: ReturnType<typeof analyzeAcceptedForward>;
  errors: string[];
  markdown: string;
};

export async function runEmaV2ForensicsReport(input: {
  symbol: string;
  calendarDays: number;
  effectiveBudgetUsd: number;
  auth: AlpacaAuth;
}): Promise<EmaV2ForensicsReport> {
  const end = lastUsEquityBacktestEndDate();
  const dates = listRecentTradingDates(end, input.calendarDays);
  const cfg = DEFAULT_EMA_TREND_DAY_V2_CONFIG;
  const allTrades: BacktestTrade[] = [];
  const allLog: SignalLogEntry[] = [];
  const barsBySession = new Map<string, MinuteBar[]>();
  const errors: string[] = [];
  let daysWithData = 0;

  for (const sessionDate of dates) {
    try {
      const raw = await fetchMinuteBarsForDay(input.symbol, sessionDate, input.auth);
      const bars = filterRegularSessionBars(raw, sessionDate);
      if (bars.length < 20) continue;
      daysWithData += 1;
      barsBySession.set(sessionDate, bars);
      const day = simulateEmaTrendDayV2(sessionDate, bars, input.effectiveBudgetUsd, cfg);
      allTrades.push(...day.trades);
      allLog.push(...day.signalLog);
    } catch (e) {
      errors.push(`${sessionDate}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  const summaryMetrics = aggregateV2BacktestMetrics(
    allTrades,
    daysWithData,
    allLog,
    cfg.slippageBps,
    cfg.commissionPerShare,
  );

  const entryForensics: EntryForensicsRow[] = [];
  for (const t of allTrades) {
    const bars = barsBySession.get(t.sessionDate);
    if (!bars) continue;
    const i = findBarIndexByTimeEt(bars, t.entryTimeEt);
    if (i < 0) continue;
    const contexts = buildBarContexts(bars);
    entryForensics.push(
      buildEntryForensics(
        t.sessionDate,
        bars,
        contexts,
        i,
        t.entryTimeEt,
        t.entryPrice,
        t.setupType,
        t.pnlUsd,
      ),
    );
  }

  const postEntry: PostEntryAnalysis[] = [];
  for (const t of allTrades) {
    const bars = barsBySession.get(t.sessionDate);
    if (!bars) continue;
    const row = analyzePostEntry(bars, t, t.shares);
    if (row) postEntry.push(row);
  }

  const pullbackTrades = allTrades.filter(t => t.setupType === 'ema_pullback_confirmed');
  const winnerTrade =
    pullbackTrades.find(t => t.sessionDate.endsWith('-08-14') && t.pnlUsd > 0) ??
    [...pullbackTrades].sort((a, b) => b.pnlUsd - a.pnlUsd)[0] ??
    [...allTrades].sort((a, b) => b.pnlUsd - a.pnlUsd)[0];
  const winnerRow = winnerTrade
    ? entryForensics.find(
        e => e.sessionDate === winnerTrade.sessionDate && e.entryTimeEt === winnerTrade.entryTimeEt,
      ) ?? null
    : null;
  const loserRows = entryForensics.filter(
    e =>
      e.setupType === 'ema_pullback_confirmed' &&
      (!winnerRow || e.sessionDate !== winnerRow.sessionDate || e.entryTimeEt !== winnerRow.entryTimeEt),
  );

  const compareTable: { feature: string; winner: string; avgLoser: string; diff: string }[] =
    COMPARE_NUMERIC_KEYS.map(key => {
    const w = winnerRow?.[key];
    const avg = avgForensics(loserRows, key);
    const wNum = typeof w === 'number' ? w : null;
    const diff = wNum != null && avg != null ? wNum - avg : null;
    return {
      feature: key,
      winner: wNum != null ? fmtNum(wNum) : '—',
      avgLoser: avg != null ? fmtNum(avg) : '—',
      diff: diff != null ? fmtNum(diff) : '—',
    };
  });

  if (winnerRow && loserRows.length) {
    const brokeWin = winnerRow.brokePrior2BarHigh;
    const brokeAvg = loserRows.filter(r => r.brokePrior2BarHigh).length / loserRows.length;
    compareTable.push({
      feature: 'brokePrior2BarHigh (rate)',
      winner: brokeWin ? '1' : '0',
      avgLoser: brokeAvg.toFixed(2),
      diff: (Number(brokeWin) - brokeAvg).toFixed(2),
    });
    if (winnerRow.percentB != null) {
      const avgPb =
        loserRows.map(r => r.percentB).filter((n): n is number => n != null);
      const avgP = avgPb.length ? avgPb.reduce((a, x) => a + x, 0) / avgPb.length : null;
      compareTable.push({
        feature: 'percentB',
        winner: fmtNum(winnerRow.percentB),
        avgLoser: avgP != null ? fmtNum(avgP) : '—',
        diff: avgP != null ? fmtNum(winnerRow.percentB - avgP) : '—',
      });
    }
  }

  const momentumTimelines = pullbackTrades.map(t =>
    replayPullbackMomentumTimeline(t.sessionDate, barsBySession.get(t.sessionDate)!, t.entryTimeEt, cfg),
  );

  const productionCandidates = allLog.filter(s => s.accepted).length;

  const variantSims: VariantSimRow[] = [];
  for (const variant of FORENSICS_VARIANTS) {
    const vTrades: BacktestTrade[] = [];
    for (const sessionDate of dates) {
      const bars = barsBySession.get(sessionDate);
      if (!bars) continue;
      const day = simulateEmaTrendDayV2(sessionDate, bars, input.effectiveBudgetUsd, {
        ...cfg,
        forensicsDelayedEntryVariant: variant,
      });
      vTrades.push(...day.trades);
    }
    const metrics = aggregateV2BacktestMetrics(
      vTrades,
      daysWithData,
      [],
      cfg.slippageBps,
      cfg.commissionPerShare,
    );
    variantSims.push({
      variant,
      candidateTrades: productionCandidates,
      executedTrades: vTrades.length,
      metrics,
    });
  }

  const rejectionBuckets = analyzeRejections(allLog, barsBySession);
  const acceptedForward = analyzeAcceptedForward(allLog, barsBySession);

  const report: EmaV2ForensicsReport = {
    symbol: input.symbol,
    calendarDays: input.calendarDays,
    daysWithData,
    summaryMetrics,
    rejectedSignalCount: allLog.filter(s => !s.accepted).length,
    entryForensics,
    postEntry,
    winnerRow,
    loserRows,
    compareTable,
    momentumTimelines,
    variantSims,
    rejectionBuckets,
    acceptedForward,
    errors: errors.slice(0, 8),
    markdown: '',
  };
  report.markdown = formatForensicsMarkdown(report);
  return report;
}

function fmtNum(n: number): string {
  if (Math.abs(n) >= 100) return n.toFixed(2);
  if (Math.abs(n) >= 1) return n.toFixed(3);
  return n.toFixed(4);
}
