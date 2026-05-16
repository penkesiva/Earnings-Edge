import { FinalVerdictBadge } from '@/components/FinalVerdictBadge';
import { FinalActionBadge, ConvictionArrows } from '@/components/SignalBadge';
import { parseSynthesisResponse } from '@/lib/aiConsensus';

/**
 * Dashboard RESULT column: Final Verdict when saved, otherwise system reconcile action.
 */
export function DashboardResultCell({
  systemAction,
  consensusText,
  compact,
}: {
  systemAction: string | null;
  consensusText?: string | null;
  /** Hide row labels on tight mobile card layout */
  compact?: boolean;
}) {
  const parsed = consensusText?.trim()
    ? parseSynthesisResponse(consensusText)
    : null;

  if (parsed) {
    if (compact) {
      return (
        <FinalVerdictBadge verdict={parsed.verdict} direction={parsed.direction} />
      );
    }
    return (
      <div className="flex flex-col gap-1 min-w-0">
        <span className="text-[9px] text-fg-dim tracking-widest uppercase">Final verdict</span>
        <FinalVerdictBadge verdict={parsed.verdict} direction={parsed.direction} />
        {systemAction && (
          <div className="flex flex-wrap items-center gap-1 min-w-0">
            <span className="text-[9px] text-fg-dim tracking-widest uppercase w-full">System</span>
            <ConvictionArrows action={systemAction} />
            <FinalActionBadge action={systemAction} />
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-0.5 min-w-0">
      {!compact && (
        <span className="text-[9px] text-fg-dim tracking-widest uppercase">System</span>
      )}
      <div className="flex flex-wrap items-center gap-1.5">
        <ConvictionArrows action={systemAction} />
        <FinalActionBadge action={systemAction} />
      </div>
    </div>
  );
}
