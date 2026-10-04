import { addCalendarDays, isUsEquityWeekday, usEquityTimestamp } from '@/lib/earningsDate';
import { getHistoricalBars } from '@/lib/alpaca';
import type { AlpacaAuth } from '@/lib/alpaca';
import { filterRegularSessionBars } from '@/lib/intraday/indicators/engine';
import type { MinuteBar } from '@/lib/intraday/types';

export async function fetchMinuteBarsForDay(
  symbol: string,
  sessionDate: string,
  auth: AlpacaAuth,
): Promise<MinuteBar[]> {
  const start = usEquityTimestamp(sessionDate, 9, 0);
  const end = usEquityTimestamp(sessionDate, 16, 30);
  const raw = (await getHistoricalBars(symbol, start, end, '1Min', auth)) as Array<{
    t?: string;
    o?: number;
    h?: number;
    l?: number;
    c?: number;
    v?: number;
  }>;
  return (raw ?? [])
    .filter(b => b.c != null && b.t)
    .map(b => ({
      t: b.t!,
      o: b.o ?? b.c!,
      h: b.h ?? b.c!,
      l: b.l ?? b.c!,
      c: b.c!,
      v: b.v ?? 0,
    }));
}

/** RTH 1m bars for the `sessions` trading days before `sessionDate` that have data, oldest first. */
export async function fetchPriorSessionBars(
  symbol: string,
  sessionDate: string,
  sessions: number,
  auth: AlpacaAuth,
): Promise<MinuteBar[]> {
  const candidates = listRecentTradingDates(addCalendarDays(sessionDate, -1), sessions + 4).reverse();
  const found: MinuteBar[][] = [];
  for (const d of candidates) {
    if (found.length >= sessions) break;
    const bars = filterRegularSessionBars(await fetchMinuteBarsForDay(symbol, d, auth), d);
    if (bars.length >= 20) found.unshift(bars);
  }
  return found.flat();
}

export function listRecentTradingDates(endDate: string, calendarDays: number): string[] {
  const out: string[] = [];
  let d = endDate;
  let scanned = 0;
  while (out.length < calendarDays && scanned < calendarDays * 2 + 10) {
    if (isUsEquityWeekday(d)) out.push(d);
    d = addCalendarDays(d, -1);
    scanned += 1;
  }
  return out.reverse();
}
