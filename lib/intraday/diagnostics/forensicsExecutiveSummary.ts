import type { EmaV2ForensicsReport } from '@/lib/intraday/diagnostics/runEmaV2ForensicsReport';

/** Short answers for UI — production strategy unchanged; same trade list as backtest is expected. */
export function buildForensicsExecutiveSummary(r: EmaV2ForensicsReport): string {
  const m = r.summaryMetrics;
  const lines: string[] = [
    `V2 FORENSICS — ${r.symbol} (${r.daysWithData} sessions)`,
    '',
    'IMPORTANT: This does NOT change "Run backtest" trades. Same 10 pullbacks is expected.',
    'Use sections below to diagnose Aug-14 vs losers; variants B–E are replay-only.',
    '',
    `Production: ${m.trades} trades | P&L $${m.totalPnlUsd.toFixed(2)} | WR ${m.winRate?.toFixed(0) ?? '—'}% | PF ${m.profitFactor?.toFixed(2) ?? '—'} | rejected signals ${r.rejectedSignalCount}`,
  ];

  if (r.winnerRow) {
    lines.push(
      '',
      `Winner: ${r.winnerRow.sessionDate} ${r.winnerRow.entryTimeEt} $${r.winnerRow.pnlUsd.toFixed(2)}`,
      `  broke 2-bar high: ${r.winnerRow.brokePrior2BarHigh ? 'YES' : 'no'} | ret3m: ${(r.winnerRow.return3m * 100).toFixed(3)}% | close loc: ${r.winnerRow.closeLocation.toFixed(2)} | vol accel: ${r.winnerRow.volumeAcceleration.toFixed(2)}`,
    );
  }

  const topDiffs = [...r.compareTable]
    .filter(row => row.diff !== '—' && row.feature !== 'brokePrior2BarHigh (rate)')
    .map(row => ({ ...row, abs: Math.abs(parseFloat(row.diff) || 0) }))
    .sort((a, b) => b.abs - a.abs)
    .slice(0, 5);
  if (topDiffs.length) {
    lines.push('', 'Largest winner vs avg-loser gaps (exploratory):');
    for (const row of topDiffs) {
      lines.push(`  ${row.feature}: winner ${row.winner} vs losers ${row.avgLoser} (Δ ${row.diff})`);
    }
  }

  const classes = r.momentumTimelines.map(t => t.confirmationClass);
  const classCounts = classes.reduce(
    (acc, c) => {
      acc[c] = (acc[c] ?? 0) + 1;
      return acc;
    },
    {} as Record<string, number>,
  );
  lines.push('', `Entry confirmation class (A=touch … E=break+mom+vol): ${JSON.stringify(classCounts)}`);

  const sameBarMomentum = r.momentumTimelines.filter(
    t => t.momentumConfirmedTime && t.momentumConfirmedTime === t.entryTime,
  ).length;
  lines.push(
    `Momentum OK same bar as entry: ${sameBarMomentum}/${r.momentumTimelines.length} pullbacks (early entry if high).`,
  );

  const behaviors = r.postEntry.reduce(
    (acc, p) => {
      acc[p.behavior] = (acc[p.behavior] ?? 0) + 1;
      return acc;
    },
    {} as Record<string, number>,
  );
  lines.push('', `Post-entry behavior: ${JSON.stringify(behaviors)}`);

  const topReject = [...r.rejectionBuckets].filter(b => b.count > 0).sort((a, b) => b.count - a.count)[0];
  if (topReject) {
    lines.push(
      '',
      `Top reject bucket: ${topReject.bucket} (${topReject.count}, ${topReject.pct.toFixed(0)}%) | avg 5m after reject ${topReject.avgReturn5m?.toFixed(3) ?? '—'}%`,
    );
  }
  lines.push(
    '',
    `Accepted entries avg 5m fwd: ${r.acceptedForward.avgReturn5m?.toFixed(3) ?? '—'}% (n=${r.acceptedForward.n})`,
  );

  lines.push('', ...r.variantValidation);

  const invalidTiming = r.momentumTimelines.filter(t => !t.timingValid).length;
  if (invalidTiming) {
    lines.push(`Timing audit: ${invalidTiming}/${r.momentumTimelines.length} pullback rows invalid (do not use for setup timing).`);
  }

  lines.push('', 'Gate pass counts on production entries — see full report section 1b.');

  if (r.experimentalMetrics) {
    const em = r.experimentalMetrics;
    lines.push(
      `EXPERIMENTAL_VWAP_RESUMPTION: ${em.trades} tr | P&L $${em.totalPnlUsd.toFixed(2)} | WR ${em.winRate?.toFixed(0) ?? '—'}%`,
    );
  }

  lines.push('', 'Delayed confirmation replay:');
  for (const v of r.variantSims) {
    const vm = v.metrics;
    lines.push(
      `  ${v.variant}: executed ${v.executedTrades}/${v.candidateTrades} | P&L $${vm.totalPnlUsd.toFixed(2)} | WR ${vm.winRate?.toFixed(0) ?? '—'}% | PF ${vm.profitFactor?.toFixed(2) ?? '—'}`,
    );
  }

  lines.push('', 'Open "View full forensics report" for gate audit, VWAP/%B buckets, momentum phase, 90d rerun.');

  return lines.join('\n');
}
