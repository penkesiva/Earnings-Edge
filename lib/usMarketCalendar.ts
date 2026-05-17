import { addCalendarDays, dashboardSessionDate } from '@/lib/earningsDate';

export type UpcomingSession = {
  date: string;
  marketOpen: boolean;
};

function isoFromParts(y: number, m: number, d: number): string {
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

function utcDayOfWeek(iso: string): number {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/** NYSE full-close observation: Saturday → Friday, Sunday → Monday. */
function observeHoliday(y: number, m: number, d: number): string {
  const iso = isoFromParts(y, m, d);
  const dow = utcDayOfWeek(iso);
  if (dow === 6) return addCalendarDays(iso, -1);
  if (dow === 0) return addCalendarDays(iso, 1);
  return iso;
}

function easterSunday(year: number): { month: number; day: number } {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return { month, day };
}

function nthWeekdayOfMonth(year: number, month: number, weekday: number, n: number): string {
  let count = 0;
  for (let d = 1; d <= 31; d++) {
    const iso = isoFromParts(year, month, d);
    if (new Date(`${iso}T12:00:00`).getMonth() + 1 !== month) break;
    if (utcDayOfWeek(iso) === weekday) {
      count++;
      if (count === n) return iso;
    }
  }
  throw new Error(`nth weekday not found: ${year}-${month}`);
}

function lastWeekdayOfMonth(year: number, month: number, weekday: number): string {
  for (let d = 31; d >= 1; d--) {
    const iso = isoFromParts(year, month, d);
    if (new Date(`${iso}T12:00:00`).getMonth() + 1 !== month) continue;
    if (utcDayOfWeek(iso) === weekday) return iso;
  }
  throw new Error(`last weekday not found: ${year}-${month}`);
}

const holidayByYear = new Map<number, Set<string>>();

function nyseHolidaysForYear(year: number): Set<string> {
  const set = new Set<string>();
  set.add(observeHoliday(year, 1, 1));
  set.add(nthWeekdayOfMonth(year, 1, 1, 3));
  set.add(nthWeekdayOfMonth(year, 2, 1, 3));
  const easter = easterSunday(year);
  set.add(addCalendarDays(isoFromParts(year, easter.month, easter.day), -2));
  set.add(lastWeekdayOfMonth(year, 5, 1));
  set.add(observeHoliday(year, 6, 19));
  set.add(observeHoliday(year, 7, 4));
  set.add(nthWeekdayOfMonth(year, 9, 1, 1));
  set.add(nthWeekdayOfMonth(year, 11, 4, 4));
  set.add(observeHoliday(year, 12, 25));
  return set;
}

function holidaysForYear(year: number): Set<string> {
  let set = holidayByYear.get(year);
  if (!set) {
    set = nyseHolidaysForYear(year);
    holidayByYear.set(year, set);
  }
  return set;
}

export function isWeekend(iso: string): boolean {
  const dow = utcDayOfWeek(iso);
  return dow === 0 || dow === 6;
}

export function isNyseHoliday(iso: string): boolean {
  const y = Number(iso.slice(0, 4));
  return holidaysForYear(y).has(iso);
}

export function isTradingDay(iso: string): boolean {
  return !isWeekend(iso) && !isNyseHoliday(iso);
}

/**
 * Next `count` weekdays for the home dashboard (Pacific day boundary).
 * Sat/Sun are never listed. On weekend PT, the window starts Monday (Mon–Fri).
 * On a weekday, starts today (e.g. Tue → Tue, Wed, Thu, Fri, Mon).
 * NYSE holidays appear in the five but are marked market closed (grey).
 */
export function getHomeWeekdaySlots(
  count = 5,
  now = new Date(),
): UpcomingSession[] {
  let cursor = dashboardSessionDate(now);
  while (isWeekend(cursor)) {
    cursor = addCalendarDays(cursor, 1);
  }

  const result: UpcomingSession[] = [];
  let steps = 0;
  while (result.length < count && steps < 20) {
    if (!isWeekend(cursor)) {
      result.push({
        date: cursor,
        marketOpen: isTradingDay(cursor),
      });
    }
    cursor = addCalendarDays(cursor, 1);
    steps++;
  }

  return result;
}
