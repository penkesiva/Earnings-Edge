/**
 * EMA v2 forensic report (entry/post-entry/rejects/variants).
 * Run: pnpm tsx scripts/ema-v2-forensics.ts CCXI 30
 */

import { config } from 'dotenv';
import { writeFileSync } from 'fs';
import { resolve } from 'path';

config({ path: '.env.local' });

import { runEmaV2ForensicsReport } from '../lib/intraday/diagnostics/runEmaV2ForensicsReport';
import { resolveAlpacaAuthForUser } from '../lib/alpacaCredentials';

async function main() {
  const symbol = (process.argv[2] ?? 'CCXI').toUpperCase();
  const days = Number(process.argv[3] ?? 30);
  const budget = Number(process.argv[4] ?? 5000);

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const userId = process.env.INTRADAY_FORENSICS_USER_ID;

  if (!userId) {
    console.error('Need INTRADAY_FORENSICS_USER_ID in .env.local (user with Alpaca keys)');
    process.exit(1);
  }

  const auth = await resolveAlpacaAuthForUser(userId);
  if (!auth) {
    console.error('No Alpaca keys for INTRADAY_FORENSICS_USER_ID');
    process.exit(1);
  }

  console.log(`Running v2 forensics: ${symbol}, ${days} calendar days, budget $${budget}…`);
  const report = await runEmaV2ForensicsReport({
    symbol,
    calendarDays: days,
    effectiveBudgetUsd: budget,
    auth,
  });

  const outPath = resolve(process.cwd(), `ema-v2-forensics-${symbol}-${days}d.md`);
  writeFileSync(outPath, report.markdown, 'utf8');
  console.log(`\nWrote ${outPath}\n`);
  console.log(report.executiveSummary);
  console.log('\n--- full report in file ---\n');
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
