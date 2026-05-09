import type { FinalAction } from '@/lib/reconcile';

/**
 * FinalActionBadge — shows the reconciled single trade action.
 * Use this everywhere instead of the legacy beat-score SignalBadge.
 */
const FINAL_ACTION_STYLES: Record<
  FinalAction,
  { bg: string; text: string; label: string }
> = {
  // SKIP variants — same neutral colour, label explains why
  SKIP:                          { bg: 'bg-signal-neutral/10', text: 'text-signal-neutral', label: 'SKIP' },
  SKIP_NO_EDGE:                  { bg: 'bg-signal-neutral/10', text: 'text-signal-neutral', label: 'SKIP — NO EDGE' },
  SKIP_CONFLICT:                 { bg: 'bg-signal-neutral/10', text: 'text-signal-neutral', label: 'SKIP — CONFLICT' },
  SKIP_ASYMMETRIC_DOWNSIDE_RISK: { bg: 'bg-signal-sell/10',    text: 'text-signal-sell',    label: 'SKIP — DOWNSIDE RISK' },
  SKIP_ASYMMETRIC_UPSIDE_RISK:   { bg: 'bg-signal-buy/10',     text: 'text-signal-buy',     label: 'SKIP — UPSIDE RISK' },
  // WATCH — scream warns but bar not met
  BEARISH_WATCH: { bg: 'bg-signal-sell/10',  text: 'text-signal-sell',  label: 'BEARISH WATCH' },
  BULLISH_WATCH: { bg: 'bg-signal-buy/10',   text: 'text-signal-buy',   label: 'BULLISH WATCH' },
  // Trade structures
  IRON_CONDOR:        { bg: 'bg-signal-watch/10',   text: 'text-signal-watch',   label: 'IRON CONDOR' },
  PUT_CREDIT_SPREAD:  { bg: 'bg-signal-buy/10',     text: 'text-signal-buy',     label: 'PUT CREDIT SPREAD' },
  CALL_CREDIT_SPREAD: { bg: 'bg-signal-sell/10',    text: 'text-signal-sell',    label: 'CALL CREDIT SPREAD' },
  CALL_DEBIT_SPREAD:  { bg: 'bg-signal-watch/10',   text: 'text-signal-watch',   label: 'CALL DEBIT SPREAD' },
  PUT_DEBIT_SPREAD:   { bg: 'bg-signal-sell/10',    text: 'text-signal-sell',    label: 'PUT DEBIT SPREAD' },
  LONG_CALL:          { bg: 'bg-signal-buy/10',     text: 'text-signal-buy',     label: 'LONG CALL' },
  LONG_PUT:           { bg: 'bg-signal-sell/10',    text: 'text-signal-sell',    label: 'LONG PUT' },
};

export function FinalActionBadge({ action }: { action: string | null }) {
  const style =
    (action && FINAL_ACTION_STYLES[action as FinalAction]) ||
    FINAL_ACTION_STYLES.SKIP;
  return (
    <span
      className={`inline-block px-2 py-0.5 ${style.bg} ${style.text} text-xs font-bold tracking-widest border border-current/20`}
    >
      {style.label}
    </span>
  );
}

// ── Legacy beat-score badge ──────────────────────────────────────────────────
// Kept for the audit section on the detail page. Not shown on dashboard.

const SIGNAL_STYLES: Record<string, { bg: string; text: string; label: string }> = {
  SKIP:           { bg: 'bg-signal-neutral/10', text: 'text-signal-neutral', label: 'SKIP' },
  SMALL_SPREAD:   { bg: 'bg-signal-watch/10',   text: 'text-signal-watch',   label: 'SMALL SPREAD' },
  CALL_SPREAD:    { bg: 'bg-signal-watch/10',   text: 'text-signal-watch',   label: 'CALL SPREAD' },
  PUT_SPREAD:     { bg: 'bg-signal-sell/10',    text: 'text-signal-sell',    label: 'PUT SPREAD' },
  DIRECTIONAL:    { bg: 'bg-signal-buy/10',     text: 'text-signal-buy',     label: 'DIRECTIONAL' },
  HIGH_CONVICTION:{ bg: 'bg-signal-buy/20',     text: 'text-signal-buy',     label: 'HIGH CONVICTION' },
};

function legacySignalKey(signal: string, structureAction?: string | null) {
  if (signal !== 'SMALL_SPREAD') return signal;
  if (!structureAction) return signal;
  if (structureAction.includes('PUT_DEBIT_SPREAD')) return 'PUT_SPREAD';
  if (structureAction.includes('CALL_DEBIT_SPREAD')) return 'CALL_SPREAD';
  return signal;
}

export function SignalBadge({
  signal,
  structureAction,
}: {
  signal: string;
  structureAction?: string | null;
}) {
  const style =
    SIGNAL_STYLES[legacySignalKey(signal, structureAction)] || SIGNAL_STYLES.SKIP;
  return (
    <span
      className={`inline-block px-2 py-0.5 ${style.bg} ${style.text} text-xs font-bold tracking-widest border border-current/20`}
    >
      {style.label}
    </span>
  );
}
