import {
  finalVerdictBadgeStyle,
  finalVerdictTextCls,
  type Direction,
  type VerdictCall,
} from '@/lib/aiConsensus';

/**
 * Compact GO / NO-GO / WATCH badge with direction-aware colors.
 * GO + DOWN → red; GO + UP → green.
 */
export function FinalVerdictBadge({
  verdict,
  direction,
  fullWidth,
}: {
  verdict: VerdictCall;
  direction: Direction | null;
  /** Stretch badge on mobile dashboard cards. */
  fullWidth?: boolean;
}) {
  const panel = finalVerdictBadgeStyle(verdict, direction);
  const dirCls =
    direction === 'UP'
      ? 'text-signal-buy'
      : direction === 'DOWN'
        ? 'text-signal-sell'
        : 'text-fg-muted';

  return (
    <span
      className={`max-w-full px-2 py-1 sm:py-0.5 ${panel.bg} text-[10px] sm:text-xs font-bold tracking-widest border ${
        fullWidth ? 'flex w-full justify-center' : 'inline-block'
      } ${panel.border}`}
    >
      <span className={finalVerdictTextCls(verdict, direction)}>{verdict}</span>
      {direction ? (
        <>
          <span className="text-fg-dim"> · </span>
          <span className={dirCls}>{direction}</span>
        </>
      ) : null}
    </span>
  );
}
