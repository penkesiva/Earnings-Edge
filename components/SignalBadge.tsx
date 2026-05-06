const SIGNAL_STYLES: Record<string, { bg: string; text: string; label: string }> = {
  SKIP: { bg: 'bg-signal-neutral/10', text: 'text-signal-neutral', label: 'SKIP' },
  SMALL_SPREAD: { bg: 'bg-signal-watch/10', text: 'text-signal-watch', label: 'SMALL SPREAD' },
  DIRECTIONAL: { bg: 'bg-signal-buy/10', text: 'text-signal-buy', label: 'DIRECTIONAL' },
  HIGH_CONVICTION: { bg: 'bg-signal-buy/20', text: 'text-signal-buy', label: 'HIGH CONVICTION' },
};

export function SignalBadge({ signal }: { signal: string }) {
  const style = SIGNAL_STYLES[signal] || SIGNAL_STYLES.SKIP;
  return (
    <span className={`inline-block px-2 py-0.5 ${style.bg} ${style.text} text-xs font-bold tracking-widest border border-current/20`}>
      {style.label}
    </span>
  );
}
