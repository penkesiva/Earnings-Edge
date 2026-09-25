import { addCalendarDays } from '@/lib/earningsDate';
import { getHistoricalBars } from '@/lib/alpaca';
import type { AlpacaAuth } from '@/lib/alpaca';
import type { MinuteBar } from '@/lib/intraday/types';

export async function fetchMinuteBarsForDay(
  symbol: string,
  sessionDate: string,
  auth: AlpacaAuth,
): Promise<MinuteBar[]> {
  const start = `${sessionDate}T09:00:00-04:00`;
  const end = `${sessionDate}T16:30:00-04:00`;
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

export function listRecentTradingDates(endDate: string, calendarDays: number): string[] {
  const out: string[] = [];
  let d = endDate;
  let scanned = 0;
  while (out.length < calendarDays && scanned < calendarDays * 2 + 10) {
    const dow = new Date(`${d}T12:00:00Z`).getUTCDay();
    if (dow !== 0 && dow !== 6) out.push(d);
    d = addCalendarDays(d, -1);
    scanned += 1;
  }
  return out.reverse();
}
