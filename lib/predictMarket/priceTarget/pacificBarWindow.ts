/** Alpaca bar window: Pacific wall time on session_date (PDT −07:00, matches Vercel cron notes). */

export function firstTwoHoursRthWindow(sessionDate: string): {
  startIso: string;
  endIso: string;
} {
  const pad = (n: number) => String(n).padStart(2, '0');
  return {
    startIso: new Date(`${sessionDate}T${pad(6)}:${pad(30)}:00-07:00`).toISOString(),
    endIso: new Date(`${sessionDate}T${pad(8)}:${pad(30)}:00-07:00`).toISOString(),
  };
}
