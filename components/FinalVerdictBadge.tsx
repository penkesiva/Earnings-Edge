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
}: {
  verdict: VerdictCall;
  direction: Direction | null;
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
      className={`inline-block max-w-full px-2 py-0.5 ${panel.bg} text-[10px] sm:text-xs font-bold tracking-widest border ${panel.border}`}
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
