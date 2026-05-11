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
}: {
  ticker: string;
  earningsDate: string;
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
        body: JSON.stringify({ targetDate: earningsDate }),
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
    <div className="flex flex-col items-end gap-1.5">
      <div className="flex items-center gap-3">
        <button
          type="button"
          disabled={state === 'running'}
          onClick={handleClick}
          className={`text-xs px-3 py-1.5 border tracking-widest transition-colors ${colorClass}`}
        >
          {state === 'running' ? '⟳ SCANNING…' : state === 'done' ? '✓ RE-SCANNED' : state === 'error' ? '✗ RESCAN FAILED' : '↻ RE-SCAN'}
        </button>
      </div>
      {message && (
        <div
          className={`text-xs font-mono px-2 py-1 border max-w-[28rem] text-right ${
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
