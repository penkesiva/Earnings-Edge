'use client';

import { useState } from 'react';

type Props = {
  /** 'today' triggers the daily scan; 'tomorrow' triggers the prep scan. */
  mode: 'today' | 'tomorrow';
};

export function ScanButton({ mode }: Props) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
      // Reload the page so new briefs appear — the natural feedback is seeing the list update.
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
        className={`px-2.5 py-1 text-[11px] font-bold tracking-widest border transition-colors disabled:opacity-40 ${
          mode === 'today'
            ? 'border-border bg-bg hover:border-signal-buy hover:text-signal-buy'
            : 'border-border bg-bg hover:border-signal-watch hover:text-signal-watch'
        }`}
      >
        {pending ? '…' : mode === 'today' ? 'RUN SCAN' : 'PREP'}
      </button>
      {error && (
        <span className="text-[10px] text-signal-sell max-w-[140px] truncate" title={error}>
          {error}
        </span>
      )}
    </div>
  );
}
