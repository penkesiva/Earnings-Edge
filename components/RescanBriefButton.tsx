'use client';

import { useState } from 'react';

type State = 'idle' | 'running' | 'done' | 'error';

/**
 * In-place rescan for the current brief. Calls /api/internal/run-scan with the
 * brief's earnings_date as targetDate, then refreshes the page to show new
 * scan_timestamp / final_action / scan diff.
 */
export function RescanBriefButton({
  ticker,
  earningsDate,
  className,
}: {
  ticker: string;
  earningsDate: string;
  className?: string;
}) {
  const [state, setState] = useState<State>('idle');
  const [message, setMessage] = useState('');

  async function handleClick() {
    setState('running');
    setMessage('');
    try {
      const res = await fetch('/api/internal/run-scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ targetDate: earningsDate, ticker }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setState('error');
        setMessage(data.error ?? `HTTP ${res.status}`);
        return;
      }
      if (data.idleReason) {
        setState('error');
        setMessage(
          data.idleReason === 'no_earnings_on_session_date'
            ? `No watchlist row found for ${ticker} on ${earningsDate}`
            : `Skipped: ${data.idleReason}`,
        );
        return;
      }
      setState('done');
      setMessage(`${data.count ?? 0} brief${data.count === 1 ? '' : 's'} updated`);
      // Hard reload — bypasses all browser and Next.js soft-navigation caches
      // so the brief page always shows the freshly-written DB data.
      window.location.reload();
    } catch {
      setState('error');
      setMessage('Network error');
    }
  }

  const colorClass =
    state === 'running'
      ? 'text-signal-watch border-signal-watch animate-pulse cursor-wait'
      : state === 'done'
        ? 'text-signal-buy border-signal-buy/50'
        : state === 'error'
          ? 'text-signal-sell border-signal-sell/50'
          : 'text-fg-subtle border-border hover:border-signal-watch hover:text-signal-watch';

  return (
    <div className={`flex flex-col items-stretch gap-1.5 min-w-0 ${className ?? ''}`}>
      <button
        type="button"
          disabled={state === 'running'}
          onClick={handleClick}
          aria-label={
            state === 'running' ? 'System scan in progress' : 'Run system scan'
          }
          className={`brief-scan-btn touch-target text-[11px] md:text-xs px-2 md:px-3 py-2 md:py-1.5 border tracking-widest transition-colors ${colorClass}`}
        >
          {state === 'running' ? (
            <>
              <span className="md:hidden flex flex-col items-center leading-[1.15] text-[10px]">
                <span>⟳ SYSTEM</span>
                <span>SCAN…</span>
              </span>
              <span className="hidden md:inline">⟳ SYSTEM SCAN…</span>
            </>
          ) : state === 'done' ? (
            '✓ SCANNED'
          ) : state === 'error' ? (
            '✗ FAILED'
          ) : (
            <>
              <span className="md:hidden flex flex-col items-center leading-[1.15] text-[10px]">
                <span>↻ SYSTEM</span>
                <span>SCAN</span>
              </span>
              <span className="hidden md:inline">↻ SYSTEM SCAN</span>
            </>
          )}
        </button>
      {message && (
        <div
          className={`text-xs font-mono px-2 py-1 border max-w-[28rem] text-left ${
            state === 'error'
              ? 'text-signal-sell border-signal-sell/40 bg-signal-sell/5'
              : 'text-fg-muted border-border bg-bg-elevated'
          }`}
        >
          {message}
        </div>
      )}
    </div>
  );
}
