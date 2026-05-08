/**
 * Scan diff — compares the two most recent brief_scans rows for a ticker and
 * returns only the flips that are worth showing in the UI.
 *
 * Threshold rules (mirrors reconcileSignals logic):
 *   - reconciled_action changed                  → always a flip
 *   - scream_score crosses 4 in either direction → threshold flip
 *   - directional_bias changed (bullish ↔ bearish, or ↔ mixed/none) → flip
 *   - iv_rank crosses 70 in either direction     → threshold flip
 */

export type BriefScanRow = {
  id: number;
  ticker: string;
  scan_timestamp: string;
  reconciled_action: string | null;
  scream_score: number | null;
  iv_rank: number | null;
  directional_bias: string | null;
};

export type ScanFlip = {
  field: 'reconciled_action' | 'scream_score' | 'directional_bias' | 'iv_rank';
  label: string;
  from: string;
  to: string;
  /** true = crosses a meaningful decision threshold */
  threshold: boolean;
};

export type ScanDiffResult =
  | { state: 'no_history' }
  | { state: 'single_scan'; scan: BriefScanRow }
  | {
      state: 'no_change';
      latest: BriefScanRow;
      previous: BriefScanRow;
    }
  | {
      state: 'flipped';
      latest: BriefScanRow;
      previous: BriefScanRow;
      flips: ScanFlip[];
      /** true when at least one flip crosses a decision threshold */
      critical: boolean;
    };

export function computeScanDiff(scans: BriefScanRow[]): ScanDiffResult {
  if (scans.length === 0) return { state: 'no_history' };
  if (scans.length === 1) return { state: 'single_scan', scan: scans[0] };

  // scans should arrive ordered by scan_timestamp DESC
  const latest = scans[0];
  const previous = scans[1];

  const flips: ScanFlip[] = [];

  // 1. reconciled_action changed
  if (latest.reconciled_action !== previous.reconciled_action) {
    flips.push({
      field: 'reconciled_action',
      label: 'action',
      from: previous.reconciled_action ?? '—',
      to: latest.reconciled_action ?? '—',
      threshold: true,
    });
  }

  // 2. scream_score crossed 4
  const prevScream = previous.scream_score ?? 0;
  const latScream = latest.scream_score ?? 0;
  if (prevScream !== latScream) {
    const crossedThreshold =
      (prevScream < 4 && latScream >= 4) || (prevScream >= 4 && latScream < 4);
    flips.push({
      field: 'scream_score',
      label: 'scream',
      from: `${prevScream}/5`,
      to: `${latScream}/5`,
      threshold: crossedThreshold,
    });
  }

  // 3. directional_bias changed
  if (latest.directional_bias !== previous.directional_bias) {
    const bothDefined =
      latest.directional_bias && previous.directional_bias;
    const wasDirectional =
      previous.directional_bias === 'bullish' ||
      previous.directional_bias === 'bearish';
    const isDirectional =
      latest.directional_bias === 'bullish' ||
      latest.directional_bias === 'bearish';
    const crossedThreshold =
      Boolean(bothDefined) && (wasDirectional !== isDirectional ||
        (wasDirectional && isDirectional &&
          previous.directional_bias !== latest.directional_bias));
    flips.push({
      field: 'directional_bias',
      label: 'bias',
      from: previous.directional_bias ?? '—',
      to: latest.directional_bias ?? '—',
      threshold: crossedThreshold,
    });
  }

  // 4. iv_rank crossed 70
  const prevIv = previous.iv_rank ?? 0;
  const latIv = latest.iv_rank ?? 0;
  if (Math.abs(prevIv - latIv) >= 5) {
    const crossedThreshold =
      (prevIv <= 70 && latIv > 70) || (prevIv > 70 && latIv <= 70);
    flips.push({
      field: 'iv_rank',
      label: 'IV rank',
      from: String(prevIv),
      to: String(latIv),
      threshold: crossedThreshold,
    });
  }

  if (flips.length === 0) {
    return { state: 'no_change', latest, previous };
  }

  return {
    state: 'flipped',
    latest,
    previous,
    flips,
    critical: flips.some(f => f.threshold),
  };
}

/** Format a scan_timestamp as a short time string with timezone, e.g. "3:45 PM ET". */
export function formatScanTime(isoTs: string): string {
  return new Date(isoTs).toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short',
    timeZone: 'America/New_York',
  });
}
