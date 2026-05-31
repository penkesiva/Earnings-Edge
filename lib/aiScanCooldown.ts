/** Minimum gap between full Scan All runs (AI + final verdict) on the same brief/ticker. */
export const AI_SCAN_COOLDOWN_MS = 10 * 60 * 1000;
/** @deprecated use AI_SCAN_COOLDOWN_MS */
export const SCAN_ALL_COOLDOWN_MS = AI_SCAN_COOLDOWN_MS;

export function msUntilAiScanAllowed(lastAtIso: string | null, nowMs = Date.now()): number {
  if (!lastAtIso) return 0;
  const elapsed = nowMs - new Date(lastAtIso).getTime();
  return Math.max(0, AI_SCAN_COOLDOWN_MS - elapsed);
}

/** Latest ISO timestamp from system / AI / verdict scans. */
export function latestScanTimestamp(...isoTimes: (string | null | undefined)[]): string | null {
  let latest: string | null = null;
  for (const t of isoTimes) {
    if (!t) continue;
    if (!latest || t > latest) latest = t;
  }
  return latest;
}

export function formatCooldownWait(ms: number): string {
  const mins = Math.ceil(ms / 60_000);
  return mins <= 1 ? '1m' : `${mins}m`;
}

export function formatScanAge(isoTs: string): string {
  const ms = Date.now() - new Date(isoTs).getTime();
  const mins = Math.floor(ms / 60_000);
  const hours = Math.floor(ms / 3_600_000);
  if (mins < 2) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  if (hours < 24) return `${hours}h ago`;
  return new Date(isoTs).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  });
}
