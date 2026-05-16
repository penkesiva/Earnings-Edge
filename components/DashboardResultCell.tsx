import { FinalActionBadge, ConvictionArrows } from '@/components/SignalBadge';
import {
  parseSynthesisResponse,
  type Direction,
  type VerdictCall,
} from '@/lib/aiConsensus';

function verdictBadgeCls(v: VerdictCall): { bg: string; text: string; border: string } {
  if (v === 'GO') return { bg: 'bg-signal-buy/10', text: 'text-signal-buy', border: 'border-signal-buy/40' };
  if (v === 'NO-GO') return { bg: 'bg-signal-sell/10', text: 'text-signal-sell', border: 'border-signal-sell/40' };
  return { bg: 'bg-signal-watch/10', text: 'text-signal-watch', border: 'border-signal-watch/40' };
}

function FinalVerdictBadge({
  verdict,
  direction,
}: {
  verdict: VerdictCall;
  direction: Direction | null;
}) {
  const s = verdictBadgeCls(verdict);
  return (
    <span
      className={`inline-block max-w-full px-2 py-0.5 ${s.bg} ${s.text} text-[10px] sm:text-xs font-bold tracking-widest border ${s.border}`}
    >
      {verdict}
      {direction ? ` · ${direction}` : ''}
    </span>
  );
}

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
