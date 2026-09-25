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
  ];

  lines.push(
    '---',
    '## 1b. VERIFY delayed confirmation (production accepted candidates)',
    '',
    ...r.variantValidation,
    '',
    '| Session | Time | B | C | D | E |',
    '| --- | --- | --- | --- | --- | --- |',
  );

  for (const g of r.gateAudit) {
    lines.push(
      `| ${g.sessionDate} | ${g.timeEt} | ${g.B.pass ? 'PASS' : 'FAIL'} | ${g.C.pass ? 'PASS' : 'FAIL'} | ${g.D.pass ? 'PASS' : 'FAIL'} | ${g.E.pass ? 'PASS' : 'FAIL'} |`,
    );
  }

  lines.push('', 'Gate detail:');
  for (const g of r.gateAudit) {
    lines.push(`${g.sessionDate} ${g.timeEt}:`, `  B: ${g.B.reason}`, `  C: ${g.C.reason}`, `  D: ${g.D.reason}`, `  E: ${g.E.reason}`, '');
  }

  lines.push('---', '## 2. Post-entry analysis', '');

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

  lines.push('', '---', '## 4. Momentum / pullback timing (fixed per-entry replay)', '');
  for (const t of r.momentumTimelines) {
    const flag = t.timingValid ? 'OK' : `DATA/STATE ERROR: ${t.timingError ?? '?'}`;
    lines.push(
      `${t.sessionDate} ${t.entryTimeEt}: pullback ${t.pullbackDetectedTime ?? '—'} → momentum ${t.momentumConfirmedTime ?? '—'} → entry ${t.entryTime} | ${flag}`,
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
      `| ${v.variant} | ${v.candidateTrades} | ${v.executedTrades} | ${vm.winRate?.toFixed(1) ?? '—'}% | $${vm.totalPnlUsd.toFixed(2)} | ${vm.profitFactor?.toFixed(2) ?? '—'} | $${vm.expectancyPerTrade?.toFixed(2) ?? '—'} | $${vm.maxDrawdownUsd.toFixed(2)} | $${vm.avgMfeUsd?.toFixed(2) ?? '—'} | $${vm.avgMaeUsd?.toFixed(2) ?? '—'} | fp ${v.entryFingerprint} |`,
    );
  }

  lines.push(
    '',
    '---',
    '## 6. VWAP proximity buckets (exploratory, no optimal threshold)',
    '',
    '| Bucket | Candidates | Trades | avg 5m | avg 10m | avg 20m | MFE | MAE | WR | Exp |',
    '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |',
  );
  for (const row of r.vwapProximity) {
    lines.push(
      `| ${row.bucket} | ${row.candidateCount} | ${row.tradeCount} | ${fmt(row.avgReturn5m, 3)}% | ${fmt(row.avgReturn10m, 3)}% | ${fmt(row.avgReturn20m, 3)}% | ${fmt(row.avgMfePct, 3)}% | ${fmt(row.avgMaePct, 3)}% | ${row.winRate?.toFixed(0) ?? '—'}% | $${row.expectancyUsd?.toFixed(2) ?? '—'} |`,
    );
  }

  lines.push('', '---', '## 7. Bollinger %B and bandwidth', '', '### %B buckets');
  for (const row of r.bollingerBuckets.percentB) {
    lines.push(
      `${row.bucket}: candidates ${row.candidateCount} | trades ${row.tradeCount} | W ${row.winnerCount} L ${row.loserCount}`,
    );
  }
  lines.push('', '### Bandwidth regime');
  for (const row of r.bollingerBuckets.bandwidth) {
    lines.push(
      `${row.bucket}: candidates ${row.candidateCount} | trades ${row.tradeCount} | W ${row.winnerCount} L ${row.loserCount}`,
    );
  }

  lines.push('', '---', '## 8. Momentum phase at entry', '');
  for (const p of r.momentumPhasesAtEntry) {
    lines.push(`${p.sessionDate} ${p.entryTimeEt}: ${p.phase} — ${p.lines.join('; ')}`);
  }

  if (r.experimentalMetrics) {
    const em = r.experimentalMetrics;
    lines.push(
      '',
      '---',
      '## 9. EXPERIMENTAL_VWAP_RESUMPTION (forensics only, not production)',
      '',
      `Trades ${em.trades} | P&L $${em.totalPnlUsd.toFixed(2)} | WR ${em.winRate?.toFixed(1) ?? '—'}% | PF ${em.profitFactor?.toFixed(2) ?? '—'} | DD $${em.maxDrawdownUsd.toFixed(2)}`,
    );
  }

  lines.push(
    '',
    '---',
    '## 10. Rejected signals by bucket',
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
    '## 11. Diagnostic questions (manual read)',
    '',
    'Do not tune from small samples. Re-run with calendar_days=90 for larger n.',
    '',
    '1. Aug-14 winner: winner vs avg loser table + VWAP bucket.',
    '2. Gate audit: which of 10 production entries pass B/C/D/E (identical variant metrics means same pass set).',
    '3. Timing rows flagged DATA/STATE ERROR must be excluded from setup conclusions.',
    '4. Momentum phase: losers skew EXTENDED/FADING vs BUILDING/EXPANDING?',
    '5. Rejects vs accepted forward returns in section 10.',
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
