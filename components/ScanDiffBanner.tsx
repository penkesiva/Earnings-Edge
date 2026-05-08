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

  if (critical) {
    // Full-width banner for decision-relevant flips
    return (
      <div className="border border-signal-sell bg-signal-sell/5 px-4 py-3 space-y-2">
        <div className="flex items-center gap-2">
          <span className="text-signal-sell font-bold text-sm">⚠ FLIPPED</span>
          <span className="text-signal-sell text-xs font-mono">since {previousTime} scan</span>
          <span className="text-fg-dim text-[10px] font-mono ml-auto">last scan {latestTime}</span>
        </div>
        <ul className="space-y-1 font-mono text-xs">
          {flips.map((f, i) => (
            <li key={i} className="flex items-baseline gap-2">
              <span className={f.threshold ? 'text-signal-sell' : 'text-fg-dim'}>
                {f.threshold ? '▸' : '·'}
              </span>
              <span className="text-fg-subtle w-20 shrink-0">{f.label}</span>
              <span className="text-fg-dim">{f.from}</span>
              <span className="text-fg-dim">→</span>
              <span className={f.threshold ? 'text-signal-sell font-bold' : 'text-fg-subtle'}>
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

  // Non-critical changes — subtle inline display
  const iconColor = 'text-signal-watch';
  return (
    <div className="font-mono text-[11px] border-l-2 border-signal-watch pl-3 space-y-1">
      <div className="text-fg-dim">
        {ticker} · last scan {latestTime}
      </div>
      <div className={`font-bold ${iconColor} flex items-center gap-1.5`}>
        <span>△</span>
        <span>Changed since {previousTime} scan</span>
      </div>
      <ul className="space-y-0.5 pl-1">
        {flips.map((f, i) => (
          <li key={i} className="flex items-baseline gap-1.5">
            <span className="text-fg-dim">·</span>
            <span className="text-fg-subtle w-20 shrink-0">{f.label}</span>
            <span className="text-fg-dim">{f.from}</span>
            <span className="text-fg-dim">→</span>
            <span className="text-fg-subtle">{f.to}</span>
            {f.field === 'scream_score' && (
              <span className="text-fg-dim">(still below bar)</span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
