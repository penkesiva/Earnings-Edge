import { addCalendarDays } from '@/lib/earningsDate';
import { isTradingDay } from '@/lib/usMarketCalendar';

const ET = 'America/New_York';

export type EtStamp = { date: string; minutes: number };

export function etStamp(iso: string): EtStamp {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: ET,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(iso));
  const get = (type: string) => parts.find(p => p.type === type)?.value ?? '';
  const hour = get('hour') === '24' ? 0 : Number(get('hour'));
  return {
    date: `${get('year')}-${get('month')}-${get('day')}`,
    minutes: hour * 60 + Number(get('minute')),
  };
}

export function previousTradingDay(iso: string): string {
  let d = addCalendarDays(iso, -1);
  for (let i = 0; i < 10 && !isTradingDay(d); i++) d = addCalendarDays(d, -1);
  return d;
}

/** Walk back `sessions` finished trading days, including `end`. Capped at 20. */
export function sessionWindow(end: string, sessions: number): { start: string; end: string } {
  const n = Math.min(20, Math.max(1, Math.floor(sessions)));
  let start = end;
  for (let i = 1; i < n; i++) start = previousTradingDay(start);
  return { start, end };
}

/** Last regular session that has already finished (4:05 PM ET). */
export function lastCompletedSessionDate(now = new Date()): string {
  const et = etStamp(now.toISOString());
  if (isTradingDay(et.date) && et.minutes >= 16 * 60 + 5) return et.date;
  return previousTradingDay(et.date);
}
