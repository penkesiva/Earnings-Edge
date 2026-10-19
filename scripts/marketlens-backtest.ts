/**
 * MarketLens SPY paper backtest. No orders are sent.
 *
 *   npm run marketlens
 *   npm run marketlens -- 20
 *   npm run marketlens -- 2026-10-01 2026-10-16
 */
import { config } from 'dotenv';
config({ path: '.env.local' });

import { addCalendarDays } from '../lib/earningsDate';
import { runMarketLensBacktest } from '../lib/marketLens/backtest';
import { lastCompletedSessionDate } from '../lib/marketLens/sessionTime';

function rangeFromArgs(argv: string[]): { start: string; end: string } {
  const end = lastCompletedSessionDate();
  if (argv.length === 1 && /^\d+$/.test(argv[0])) {
    return { start: addCalendarDays(end, -Number(argv[0])), end };
  }
  if (argv.length === 2 && /^\d{4}-\d{2}-\d{2}$/.test(argv[0]) && /^\d{4}-\d{2}-\d{2}$/.test(argv[1])) {
    return { start: argv[0], end: argv[1] };
  }
  return { start: addCalendarDays(end, -14), end };
}

async function main() {
  const { start, end } = rangeFromArgs(process.argv.slice(2));
  console.log(`MarketLens SPY paper replay ${start} to ${end}`);
  const { days, summary } = await runMarketLensBacktest(start, end);
  console.log(
    `Sessions ${summary.sessions}  signal days ${summary.signalDays}  trades ${summary.trades}  ` +
      `wins ${summary.wins}  losses ${summary.losses}  total R ${summary.totalR.toFixed(2)}  ` +
      `avg R ${summary.avgR == null ? 'n/a' : summary.avgR.toFixed(2)}  ambiguous ${summary.ambiguousBars}`,
  );
  console.log('Probability is INSUFFICIENT_EVIDENCE. This is not a high-conviction claim.');
  for (const day of days) {
    if (!day.trades.length) continue;
    for (const t of day.trades) {
      console.log(
        `${day.sessionDate}  ${t.setup}  ${t.side}  entry ${t.entry.toFixed(2)}  stop ${t.stop.toFixed(2)}  ` +
          `target ${t.target.toFixed(2)}  exit ${t.exit.toFixed(2)}  ${t.exitReason}  R ${t.rMultiple.toFixed(2)}` +
          (t.ambiguousBar ? '  ambiguous' : ''),
      );
    }
  }
}

main().catch(err => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
