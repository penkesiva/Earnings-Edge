'use client';

import { useState } from 'react';

type Props = {
  /** 'today' triggers the daily scan; 'tomorrow' triggers the prep scan. */
  mode: 'today' | 'tomorrow';
};

export function ScanButton({ mode }: Props) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const accentIdle   = mode === 'today' ? 'hover:border-signal-buy hover:text-signal-buy'    : 'hover:border-signal-watch hover:text-signal-watch';
  const accentActive = mode === 'today' ? 'border-signal-buy text-signal-buy'                 : 'border-signal-watch text-signal-watch';

  async function run() {
    setError(null);
    setPending(true);
    try {
      const res = await fetch('/api/internal/run-scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(mode === 'tomorrow' ? { prep: 'tomorrow' } : {}),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? `HTTP ${res.status}`);
        return;
      }
      // Page reload shows the updated brief list naturally.
      window.location.reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed');
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={run}
        disabled={pending}
        className={`px-3 py-1.5 text-xs font-bold tracking-widest border transition-colors ${
          pending
            ? `${accentActive} animate-pulse cursor-not-allowed`
            : `border-border bg-bg ${accentIdle}`
        }`}
      >
        {pending
          ? mode === 'today' ? 'SCANNING…' : 'PREPPING…'
          : mode === 'today' ? 'RUN SCAN'  : 'PREP'}
      </button>
      {error && (
        <span
          className="text-[10px] text-signal-sell font-mono max-w-[160px] truncate"
          title={error}
        >
          {error}
        </span>
      )}
    </div>
  );
}
