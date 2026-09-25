import { formatCompareMetricsLine } from '@/lib/intraday/backtest/compareEmaTrend';
import type { EmaV2ForensicsReport } from '@/lib/intraday/diagnostics/runEmaV2ForensicsReport';
import type { EntryForensicsRow } from '@/lib/intraday/diagnostics/entryForensics';

function fmtPct(n: number | null | undefined, digits = 2): string {
  if (n == null || !Number.isFinite(n)) return '—';
  return `${n.toFixed(digits)}%`;
}

function fmt(n: number | null | undefined, digits = 4): string {
  if (n == null || !Number.isFinite(n)) return '—';
  return n.toFixed(digits);
}

function entryBlock(e: EntryForensicsRow): string {
  return [
    `### ${e.sessionDate} ${e.entryTimeEt} (${e.setupType}) P&L $${e.pnlUsd.toFixed(2)}`,
    `entry price: ${e.entryPrice.toFixed(4)}`,
    `EMA9: ${fmt(e.ema9, 3)} | EMA20: ${fmt(e.ema20, 3)} | spread: ${fmt(e.emaSpreadPct, 3)}% | Δspread: ${fmt(e.emaSpreadChange, 4)}`,
    `EMA9 slope: ${fmt(e.ema9Slope, 6)} | EMA20 slope: ${fmt(e.ema20Slope, 6)}`,
    `VWAP: ${fmt(e.vwap, 3)} | VWAP slope: ${fmt(e.vwapSlope, 6)} | dist VWAP: ${fmt(e.distVwapPct, 3)}%`,
    `return 1m/3m/5m: ${fmt(e.return1m, 5)} / ${fmt(e.return3m, 5)} / ${fmt(e.return5m, 5)}`,
    `body: ${fmt(e.bodyPct, 2)}% | close loc: ${fmt(e.closeLocation, 3)} | upper wick: ${fmt(e.upperWickPct, 1)}% | lower wick: ${fmt(e.lowerWickPct, 1)}%`,
    `rel vol: ${fmt(e.relativeVolume, 2)} | vol accel: ${fmt(e.volumeAcceleration, 2)}`,
    `prior highs 1/2/3: ${e.priorHigh1?.toFixed(3) ?? '—'} / ${e.priorHigh2?.toFixed(3) ?? '—'} / ${e.priorHigh3?.toFixed(3) ?? '—'}`,
    `broke 2-bar high: ${e.brokePrior2BarHigh ? 'YES' : 'no'}`,
    `BB upper/mid/lower: ${fmt(e.bbUpper, 3)} / ${fmt(e.bbMiddle, 3)} / ${fmt(e.bbLower, 3)}`,
    `bandwidth: ${fmt(e.bandwidth, 3)}% | Δbw: ${fmt(e.bandwidthSlope, 4)} | %B: ${fmt(e.percentB, 3)}`,
    `dist EMA9/20: ${fmt(e.distEma9Pct, 3)}% / ${fmt(e.distEma20Pct, 3)}%`,
    `EMA crosses 30m: ${e.emaCrossCount30} | VWAP crosses 30m: ${e.vwapCrossCount30}`,
  ].join('\n');
}

export function formatForensicsMarkdown(r: EmaV2ForensicsReport): string {
  const m = r.summaryMetrics;
  const lines: string[] = [
    `# EMA v2 forensics — ${r.symbol} (${r.calendarDays}d, ${r.daysWithData} sessions)`,
    '',
    '## Summary (production config, not tuned)',
    formatCompareMetricsLine('All trades', m),
    `Rejected signals: ${r.rejectedSignalCount}`,
    '',
    'Exploratory only (n=' + r.entryForensics.length + ' trades). Not statistical significance.',
    '',
    '---',
    '## 1. Entry forensics (all trades)',
    '',
    ...r.entryForensics.flatMap(e => [entryBlock(e), '']),
    '---',
    '## 2. Post-entry analysis',
    '',
  ];

  for (const p of r.postEntry) {
    lines.push(
      `${p.sessionDate} ${p.entryTimeEt}: behavior=${p.behavior} | P&L $${p.pnlUsd.toFixed(2)}`,
      `  fwd ret 1/3/5/10/20/30m: ${fmtPct((p.return1m ?? 0) * 100, 3)} / ${fmtPct((p.return3m ?? 0) * 100, 3)} / ${fmtPct((p.return5m ?? 0) * 100, 3)} / ${fmtPct((p.return10m ?? 0) * 100, 3)} / ${fmtPct((p.return20m ?? 0) * 100, 3)} / ${fmtPct((p.return30m ?? 0) * 100, 3)}`,
      `  MFE ${fmt(p.mfePct, 2)}% | MAE ${fmt(p.maePct, 2)}% | t→MFE ${p.timeToMfeMinutes ?? '—'}m | t→MAE ${p.timeToMaeMinutes ?? '—'}m`,
      '',
    );
  }

  lines.push(
    '---',
    '## 3. Winner vs average loser (pullback-focused)',
    '',
    winnerLabel(r),
    '',
    '| FEATURE | WINNER | AVG LOSER | DIFF |',
    '| --- | --- | --- | --- |',
  );

  for (const row of r.compareTable) {
    lines.push(`| ${row.feature} | ${row.winner} | ${row.avgLoser} | ${row.diff} |`);
  }

  lines.push('', '---', '## 4. Momentum / pullback timing', '');
  for (const t of r.momentumTimelines) {
    lines.push(
      `${t.sessionDate} ${t.entryTimeEt}: pullback detected ${t.pullbackDetectedTime ?? '—'} → momentum OK ${t.momentumConfirmedTime ?? '—'} → entry ${t.entryTime} | class ${t.confirmationClass}`,
    );
  }
  lines.push(
    '',
    'Classes: A=EMA touch only, B=bullish candle, C=candle+short momentum, D=2-bar high break (+mom), E=break+mom+volume',
    '',
    '---',
    '## 5. Delayed confirmation variants (same production filters + extra gate)',
    '',
    '| Var | Candidates | Executed | WR | P&L | PF | Exp | DD | avg MFE | avg MAE |',
    '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |',
  );

  for (const v of r.variantSims) {
    const vm = v.metrics;
    lines.push(
      `| ${v.variant} | ${v.candidateTrades} | ${v.executedTrades} | ${vm.winRate?.toFixed(1) ?? '—'}% | $${vm.totalPnlUsd.toFixed(2)} | ${vm.profitFactor?.toFixed(2) ?? '—'} | $${vm.expectancyPerTrade?.toFixed(2) ?? '—'} | $${vm.maxDrawdownUsd.toFixed(2)} | $${vm.avgMfeUsd?.toFixed(2) ?? '—'} | $${vm.avgMaeUsd?.toFixed(2) ?? '—'} |`,
    );
  }

  lines.push(
    '',
    '---',
    '## 6. Rejected signals by bucket',
    '',
    'COOLDOWN/TIME: not logged in signal log (skipped before candidate log). Counts are 0 here.',
    '',
    '| Bucket | Count | % | avg 5m ret | avg 10m ret | avg 20m ret | avg 20m MFE |',
    '| --- | --- | --- | --- | --- | --- | --- |',
  );

  for (const b of r.rejectionBuckets.filter(x => x.count > 0)) {
    lines.push(
      `| ${b.bucket} | ${b.count} | ${b.pct.toFixed(1)}% | ${fmt(b.avgReturn5m, 3)}% | ${fmt(b.avgReturn10m, 3)}% | ${fmt(b.avgReturn20m, 3)}% | ${fmt(b.avgMfePct, 3)}% |`,
    );
  }

  lines.push(
    '',
    `Accepted entries forward (n=${r.acceptedForward.n}): avg 5m ${fmt(r.acceptedForward.avgReturn5m, 3)}% | avg 10m ${fmt(r.acceptedForward.avgReturn10m, 3)}% | avg 20m MFE ${fmt(r.acceptedForward.avgMfe20, 3)}%`,
    '',
    '---',
    '## 7. Diagnostic questions (manual read)',
    '',
    '1. Aug-14 winner: see winner row vs avg loser table (spread, momentum, micro-break, VWAP).',
    '2. Other failures: check post-entry behavior=immediately_failed / worked_then_reversed.',
    '3. Early pullback? Compare momentumConfirmedTime vs entryTime; class A/B vs D/E.',
    '4. 736 rejects: dominant bucket counts above.',
    '5. Rejects vs accepted: compare bucket forward returns to accepted forward line.',
  );

  if (r.errors.length) {
    lines.push('', 'Errors:', ...r.errors.map(e => `- ${e}`));
  }

  return lines.join('\n');
}

function winnerLabel(r: EmaV2ForensicsReport): string {
  if (!r.winnerRow) return 'Winner: not identified';
  return `Winner: ${r.winnerRow.sessionDate} ${r.winnerRow.entryTimeEt} ($${r.winnerRow.pnlUsd.toFixed(2)}) vs avg of ${r.loserRows.length} other entries`;
}
