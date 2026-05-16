import { FinalVerdictBadge } from '@/components/FinalVerdictBadge';
import { parseSynthesisResponse } from '@/lib/aiConsensus';

/**
 * Dashboard verdict column — Final Verdict only (from saved AI synthesis).
 */
export function DashboardResultCell({
  consensusText,
  compact,
}: {
  consensusText?: string | null;
  compact?: boolean;
}) {
  const parsed = consensusText?.trim()
    ? parseSynthesisResponse(consensusText)
    : null;

  if (!parsed) {
    return (
      <span className="text-[10px] sm:text-xs text-fg-dim tracking-widest tabular-nums">
        —
      </span>
    );
  }

  if (compact) {
    return (
      <FinalVerdictBadge verdict={parsed.verdict} direction={parsed.direction} />
    );
  }

  return (
    <div className="flex flex-col gap-1 min-w-0">
      <span className="text-[9px] text-fg-dim tracking-widest uppercase">Final verdict</span>
      <FinalVerdictBadge verdict={parsed.verdict} direction={parsed.direction} />
    </div>
  );
}
