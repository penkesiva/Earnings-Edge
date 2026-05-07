const SIGNAL_STYLES: Record<string, { bg: string; text: string; label: string }> = {
  SKIP: { bg: 'bg-signal-neutral/10', text: 'text-signal-neutral', label: 'SKIP' },
  SMALL_SPREAD: { bg: 'bg-signal-watch/10', text: 'text-signal-watch', label: 'SMALL SPREAD' },
  CALL_SPREAD: { bg: 'bg-signal-watch/10', text: 'text-signal-watch', label: 'CALL SPREAD' },
  PUT_SPREAD: { bg: 'bg-signal-sell/10', text: 'text-signal-sell', label: 'PUT SPREAD' },
  DIRECTIONAL: { bg: 'bg-signal-buy/10', text: 'text-signal-buy', label: 'DIRECTIONAL' },
  HIGH_CONVICTION: { bg: 'bg-signal-buy/20', text: 'text-signal-buy', label: 'HIGH CONVICTION' },
};

function signalKey(signal: string, structureAction?: string | null) {
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
  const style = SIGNAL_STYLES[signalKey(signal, structureAction)] || SIGNAL_STYLES.SKIP;
  return (
    <span className={`inline-block px-2 py-0.5 ${style.bg} ${style.text} text-xs font-bold tracking-widest border border-current/20`}>
      {style.label}
    </span>
  );
}
