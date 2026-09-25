/**
 * US-listed earnings dates follow the America/New_York calendar (not UTC).
 * Using UTC midnight dates caused scans to miss rows or target the wrong "today".
 */

const US_EQUITY = 'America/New_York';
const DASHBOARD_TZ = 'America/Los_Angeles';

/** Calendar date YYYY-MM-DD in the US Eastern time zone (earnings DB, scans, FMP). */
export function earningsSessionDate(d = new Date()): string {
  return d.toLocaleDateString('en-CA', { timeZone: US_EQUITY });
}

/**
 * Dashboard “today” in Pacific time — home + history day boundaries roll at local midnight
 * (e.g. Friday stays on home until 11:59 PM PT, then moves to history).
 */
export function dashboardSessionDate(d = new Date()): string {
  return d.toLocaleDateString('en-CA', { timeZone: DASHBOARD_TZ });
}

/** Add calendar days to a YYYY-MM-DD string (for FMP ranges, upcoming windows). */
/** e.g. "MON, MAY 18" for dashboard day headers. */
export function formatDayHeader(isoDate: string): string {
  return new Date(`${isoDate}T12:00:00`).toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  }).toUpperCase();
}

export function addCalendarDays(isoDate: string, days: number): string {
  const [y, m, day] = isoDate.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, day));
  t.setUTCDate(t.getUTCDate() + days);
  return t.toISOString().slice(0, 10);
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

/** Wall-clock hour/minute in US Eastern for an instant. */
export function usEquityClockParts(d = new Date()): { sessionDate: string; minutes: number } {
  const sessionDate = d.toLocaleDateString('en-CA', { timeZone: US_EQUITY });
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: US_EQUITY,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(d);
  let hour = Number(parts.find(p => p.type === 'hour')?.value ?? 0);
  const minute = Number(parts.find(p => p.type === 'minute')?.value ?? 0);
  if (hour === 24) hour = 0;
  return { sessionDate, minutes: hour * 60 + minute };
}

/**
 * RFC3339 for a US Eastern wall-clock time on sessionDate (handles EST/EDT).
 */
export function usEquityTimestamp(sessionDate: string, hour: number, minute: number, second = 0): string {
  const local = `${sessionDate}T${pad2(hour)}:${pad2(minute)}:${pad2(second)}`;
  for (const offset of ['-04:00', '-05:00'] as const) {
    const iso = `${local}${offset}`;
    const d = new Date(iso);
    if (d.toLocaleDateString('en-CA', { timeZone: US_EQUITY }) !== sessionDate) continue;
    const parts = usEquityClockParts(d);
    if (parts.sessionDate === sessionDate && parts.minutes === hour * 60 + minute) return iso;
  }
  return `${local}-05:00`;
}

/** Latest session date safe for full-day 1-min backtests (skip incomplete today). */
export function lastUsEquityBacktestEndDate(now = new Date()): string {
  const { sessionDate, minutes } = usEquityClockParts(now);
  const dow = new Date(`${sessionDate}T12:00:00Z`).getUTCDay();
  const afterClose = minutes >= 16 * 60 + 5;
  if (dow !== 0 && dow !== 6 && afterClose) return sessionDate;
  let d = sessionDate;
  for (let i = 0; i < 12; i++) {
    d = addCalendarDays(d, -1);
    const w = new Date(`${d}T12:00:00Z`).getUTCDay();
    if (w !== 0 && w !== 6) return d;
  }
  return addCalendarDays(sessionDate, -1);
}

export function isUsEquityWeekday(isoDate: string): boolean {
  const dow = new Date(`${isoDate}T12:00:00Z`).getUTCDay();
  return dow !== 0 && dow !== 6;
}
