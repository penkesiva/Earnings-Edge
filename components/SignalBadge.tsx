import type { FinalAction } from '@/lib/reconcile';

// ── Conviction arrows ────────────────────────────────────────────────────────

type ConvictionCfg = {
  dir: 'up' | 'down' | 'neutral' | 'none';
  strength: 0 | 1 | 2 | 3;
  dim?: boolean;
};

const CONVICTION_MAP: Record<FinalAction, ConvictionCfg> = {
  // Bullish structures — conviction rises with commitment
  LONG_CALL:                     { dir: 'up',      strength: 3 },
  CALL_DEBIT_SPREAD:             { dir: 'up',      strength: 2 },
  PUT_CREDIT_SPREAD:             { dir: 'up',      strength: 1 },
  BULLISH_WATCH:                 { dir: 'up',      strength: 1, dim: true },
  SKIP_ASYMMETRIC_UPSIDE_RISK:   { dir: 'up',      strength: 1, dim: true },
  // Neutral
  IRON_CONDOR:                   { dir: 'neutral', strength: 0 },
  // Bearish structures
  CALL_CREDIT_SPREAD:            { dir: 'down',    strength: 1 },
  BEARISH_WATCH:                 { dir: 'down',    strength: 1, dim: true },
  PUT_DEBIT_SPREAD:              { dir: 'down',    strength: 2 },
  LONG_PUT:                      { dir: 'down',    strength: 3 },
  SKIP_ASYMMETRIC_DOWNSIDE_RISK: { dir: 'down',    strength: 1, dim: true },
  // No directional signal
  SKIP:                          { dir: 'none',    strength: 0 },
  SKIP_NO_EDGE:                  { dir: 'none',    strength: 0 },
  SKIP_CONFLICT:                 { dir: 'none',    strength: 0 },
};

/**
 * Shows ▲/▼ arrows (1–3) reflecting directional bias and conviction strength.
 * ▲▲▲ = highest bullish conviction (LONG_CALL)
 * ▼▼▼ = highest bearish conviction (LONG_PUT)
 * Dim arrows = watching/cautious bias.
 */
export function ConvictionArrows({ action }: { action: string | null }) {
  if (!action) return null;
  const cfg = CONVICTION_MAP[action as FinalAction];
  if (!cfg) return null;

  if (cfg.dir === 'neutral') {
    return <span className="text-fg-dim text-xs font-mono leading-none" title="Neutral">—</span>;
  }
  if (cfg.dir === 'none' || cfg.strength === 0) return null;

  const isUp = cfg.dir === 'up';
  const baseColor = isUp ? 'text-signal-buy' : 'text-signal-sell';
  const dimColor  = isUp ? 'text-signal-buy/50' : 'text-signal-sell/50';
  const arrow = isUp ? '▲' : '▼';
  const label = `${cfg.dir === 'up' ? 'Bullish' : 'Bearish'} conviction ${cfg.strength}/3${cfg.dim ? ' (watching)' : ''}`;

  return (
    <span className="inline-flex items-center gap-px leading-none" title={label} aria-label={label}>
      {Array.from({ length: cfg.strength }, (_, i) => (
        <span
          key={i}
          // Each successive arrow fades slightly: full → 70% → 45%
          className={`text-[11px] font-bold ${cfg.dim ? dimColor : baseColor}`}
          style={{ opacity: cfg.dim ? 0.55 : 1 - i * 0.22 }}
        >
          {arrow}
        </span>
      ))}
    </span>
  );
}

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
      className={`inline-block max-w-full px-2 py-0.5 ${style.bg} ${style.text} text-[10px] sm:text-xs font-bold tracking-widest border border-current/20 leading-snug`}
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
      className={`inline-block max-w-full px-2 py-0.5 ${style.bg} ${style.text} text-[10px] sm:text-xs font-bold tracking-widest border border-current/20 leading-snug`}
    >
      {style.label}
    </span>
  );
}
