import { addCalendarDays, earningsSessionDate } from '@/lib/earningsDate';
import { isTradingDay } from '@/lib/usMarketCalendar';

const PT = 'America/Los_Angeles';

/** Current wall-clock parts in Pacific (PredictMarket schedule). */
export function pacificParts(now = new Date()) {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: PT,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  const parts = fmt.formatToParts(now);
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find(p => p.type === type)?.value ?? '';
  return {
    date: `${get('year')}-${get('month')}-${get('day')}`,
    hour: Number(get('hour')),
    minute: Number(get('minute')),
  };
}

export function pacificIsoTimestamp(now = new Date()): string {
  return now.toLocaleString('sv-SE', { timeZone: PT }).replace(' ', 'T');
}

/** Next NYSE trading session date (ET calendar) from now. */
export function nextTradingSessionDate(now = new Date()): string {
  let d = earningsSessionDate(now);
  if (!isTradingDay(d)) {
    while (!isTradingDay(d)) d = addCalendarDays(d, 1);
    return d;
  }
  const pt = pacificParts(now);
  // After ~1:30 PM PT on a session day, "next session" is the following trading day.
  if (pt.hour > 13 || (pt.hour === 13 && pt.minute >= 30)) {
    d = addCalendarDays(d, 1);
    while (!isTradingDay(d)) d = addCalendarDays(d, 1);
  }
  return d;
}

/** Session date targeted by the 9 PM PT night forecast from current PT clock. */
export function nightForecastSessionDate(now = new Date()): string {
  const pt = pacificParts(now);
  let base = pt.date;
  if (pt.hour >= 21) {
    base = addCalendarDays(base, 1);
  }
  while (!isTradingDay(base)) base = addCalendarDays(base, 1);
  return base;
}

/** True when PT time is within tolerance minutes of target HH:MM. */
export function isPacificTimeNear(
  targetHour: number,
  targetMinute: number,
  toleranceMinutes = 8,
  now = new Date(),
): boolean {
  const { hour, minute } = pacificParts(now);
  const nowM = hour * 60 + minute;
  const targetM = targetHour * 60 + targetMinute;
  return Math.abs(nowM - targetM) <= toleranceMinutes;
}
