'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

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
  const router = useRouter();
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
      router.refresh();
    } catch {
      setState('error');
      setMessage('Network error');
    }
  }

  const colorClass =
    state === 'done'
      ? 'text-signal-buy border-signal-buy/50'
      : state === 'error'
        ? 'text-signal-sell border-signal-sell/50'
        : 'text-fg-subtle border-border hover:border-signal-watch hover:text-signal-watch';

  return (
    <div className="flex items-center gap-3">
      <button
        type="button"
        disabled={state === 'running'}
        onClick={handleClick}
        className={`text-xs px-3 py-1.5 border tracking-widest transition-colors disabled:opacity-40 ${colorClass}`}
      >
        {state === 'running' ? 'SCANNING…' : state === 'done' ? '✓ RE-SCANNED' : '↻ RE-SCAN'}
      </button>
      {message && (
        <span className={`text-xs ${state === 'error' ? 'text-signal-sell' : 'text-fg-muted'}`}>
          {message}
        </span>
      )}
    </div>
  );
}
