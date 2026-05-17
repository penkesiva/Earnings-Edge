/**
 * US-listed earnings dates follow the America/New_York calendar (not UTC).
 * Using UTC midnight dates caused scans to miss rows or target the wrong "today".
 */

const US_EQUITY = 'America/New_York';

/** Calendar date YYYY-MM-DD in the US Eastern time zone. */
export function earningsSessionDate(d = new Date()): string {
  return d.toLocaleDateString('en-CA', { timeZone: US_EQUITY });
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
