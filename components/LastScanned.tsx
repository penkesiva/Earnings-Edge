'use client';

/**
 * Shows when a brief was last generated/refreshed.
 * Color shifts green → amber → red based on staleness.
 * Runs client-side so timestamps reflect the user's local timezone.
 */

type Props = { updatedAt: string | null };

function label(isoTs: string): { text: string; color: string } {
  const now = Date.now();
  const ms = now - new Date(isoTs).getTime();
  const mins = Math.floor(ms / 60_000);
  const hours = Math.floor(ms / 3_600_000);

  let text: string;
  if (mins < 2)        text = 'just now';
  else if (mins < 60)  text = `${mins}m ago`;
  else if (hours < 24) text = `${hours}h ago`;
  else                 text = new Date(isoTs).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone });

  // green < 4h, amber 4–12h, red > 12h (stale by market open next day)
  const color =
    ms < 4 * 3_600_000  ? 'text-signal-buy' :
    ms < 12 * 3_600_000 ? 'text-signal-watch' :
    'text-signal-sell';

  return { text, color };
}

export function LastScanned({ updatedAt }: Props) {
  if (!updatedAt) return null;
  const { text, color } = label(updatedAt);
  return (
    <span className={`text-[10px] font-mono tabular-nums ${color}`}>
      {text}
    </span>
  );
}
