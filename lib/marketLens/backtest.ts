import { addCalendarDays } from '@/lib/earningsDate';
import { getHistoricalBarsAll, type AlpacaAuth } from '@/lib/alpaca';
import { isTradingDay } from '@/lib/usMarketCalendar';
import { assertReplaySmoke, replaySession, type PriorSession, type SpyBar } from '@/lib/marketLens/replay';
import type { BacktestSummary, DayReplay } from '@/lib/marketLens/types';

function asBar(raw: Record<string, unknown>): SpyBar | null {
  const t = raw.t;
  const o = Number(raw.o);
  const h = Number(raw.h);
  const l = Number(raw.l);
  const c = Number(raw.c);
  const v = Number(raw.v ?? 0);
  if (typeof t !== 'string' || ![o, h, l, c].every(Number.isFinite)) return null;
  return { t, o, h, l, c, v };
}

function dayKey(iso: string): string {
  return iso.slice(0, 10);
}

export async function loadSessionBars(
  sessionDate: string,
  auth?: AlpacaAuth | null,
): Promise<{ minutes: SpyBar[]; prior: PriorSession | null }> {
  const start = addCalendarDays(sessionDate, -10);
  const end = addCalendarDays(sessionDate, 1);
  const [dailyRaw, minuteRaw] = await Promise.all([
    getHistoricalBarsAll('SPY', start, sessionDate, '1Day', auth),
    getHistoricalBarsAll('SPY', `${sessionDate}T00:00:00Z`, `${end}T00:00:00Z`, '1Min', auth),
  ]);
  const daily = dailyRaw.map(asBar).filter((b): b is SpyBar => b != null && dayKey(b.t) < sessionDate);
  const priorBar = daily[daily.length - 1];
  const prior = priorBar ? { high: priorBar.h, low: priorBar.l, close: priorBar.c } : null;
  const minutes = minuteRaw.map(asBar).filter((b): b is SpyBar => b != null);
  return { minutes, prior };
}

export async function replaySavedSession(sessionDate: string, auth?: AlpacaAuth | null): Promise<DayReplay> {
  const { minutes, prior } = await loadSessionBars(sessionDate, auth);
  if (!prior) {
    return {
      sessionDate,
      priorClose: 0,
      priorHigh: 0,
      priorLow: 0,
      trades: [],
      rejects: {},
      status: 'WAIT',
      note: 'No prior daily bar from Alpaca.',
    };
  }
  return replaySession(sessionDate, minutes, prior);
}

export function summarize(days: DayReplay[]): BacktestSummary {
  const trades = days.flatMap(d => d.trades);
  const wins = trades.filter(t => t.rMultiple > 0).length;
  const totalR = trades.reduce((s, t) => s + t.rMultiple, 0);
  return {
    sessions: days.length,
    signalDays: days.filter(d => d.trades.length > 0).length,
    trades: trades.length,
    wins,
    losses: trades.length - wins,
    avgR: trades.length ? totalR / trades.length : null,
    totalR,
    ambiguousBars: trades.filter(t => t.ambiguousBar).length,
  };
}

export async function runMarketLensBacktest(
  start: string,
  end: string,
  auth?: AlpacaAuth | null,
): Promise<{ days: DayReplay[]; summary: BacktestSummary }> {
  assertReplaySmoke();
  const days: DayReplay[] = [];
  let cursor = start;
  while (cursor <= end) {
    if (isTradingDay(cursor)) {
      days.push(await replaySavedSession(cursor, auth));
    }
    cursor = addCalendarDays(cursor, 1);
  }
  return { days, summary: summarize(days) };
}
