import { computeScanDiff, formatScanTime, type BriefScanRow } from '@/lib/scanDiff';

export function ScanDiffBanner({ ticker, scans }: { ticker: string; scans: BriefScanRow[] }) {
  const diff = computeScanDiff(scans);

  // ── No history yet ────────────────────────────────────────────────────────
  if (diff.state === 'no_history') {
    return (
      <div className="text-[11px] text-fg-dim font-mono border-b border-border-subtle pb-2">
        {ticker} · no scan history yet
      </div>
    );
  }

  // ── Only one scan — show timestamp, no comparison ─────────────────────────
  if (diff.state === 'single_scan') {
    return (
      <div className="text-[11px] text-fg-dim font-mono border-b border-border-subtle pb-2">
        {ticker} · last scan {formatScanTime(diff.scan.scan_timestamp)}
      </div>
    );
  }

  const latestTime = formatScanTime(diff.latest.scan_timestamp);
  const previousTime = formatScanTime(diff.previous.scan_timestamp);

  // ── No meaningful change ──────────────────────────────────────────────────
  if (diff.state === 'no_change') {
    return (
      <div className="font-mono text-[11px] space-y-0.5">
        <div className="text-fg-dim">
          {ticker} · last scan {latestTime}
        </div>
        <div className="text-signal-buy flex items-center gap-1.5">
          <span>✓</span>
          <span>No changes since {previousTime} scan</span>
        </div>
      </div>
    );
  }

  // ── Flips ─────────────────────────────────────────────────────────────────
  const { flips, critical } = diff;
  const borderColor = critical ? 'border-signal-sell' : 'border-signal-watch';
  const iconColor   = critical ? 'text-signal-sell'   : 'text-signal-watch';
  const icon        = critical ? '⚠' : '△';

  return (
    <div className={`font-mono text-[11px] border-l-2 ${borderColor} pl-3 space-y-1`}>
      <div className="text-fg-dim">
        {ticker} · last scan {latestTime}
      </div>
      <div className={`font-bold ${iconColor} flex items-center gap-1.5`}>
        <span>{icon}</span>
        <span>
          {critical ? 'FLIPPED' : 'Changed'} since {previousTime} scan
        </span>
      </div>
      <ul className="space-y-0.5 pl-1">
        {flips.map((f, i) => (
          <li key={i} className="flex items-baseline gap-1.5">
            <span className={f.threshold ? iconColor : 'text-fg-dim'}>
              {f.threshold ? '▸' : '·'}
            </span>
            <span className="text-fg-subtle w-20 shrink-0">{f.label}</span>
            <span className="text-fg-dim">{f.from}</span>
            <span className="text-fg-dim">→</span>
            <span className={f.threshold ? 'text-fg font-bold' : 'text-fg-subtle'}>
              {f.to}
            </span>
            {f.field === 'scream_score' && !f.threshold && (
              <span className="text-fg-dim">(still below bar)</span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
