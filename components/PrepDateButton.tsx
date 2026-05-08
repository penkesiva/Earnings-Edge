'use client';

import { useState } from 'react';

type State = 'idle' | 'running' | 'done' | 'error';

export function PrepDateButton({ date }: { date: string }) {
  const [state, setState] = useState<State>('idle');
  const [message, setMessage] = useState('');

  async function handleClick() {
    setState('running');
    setMessage('');
    try {
      const res = await fetch('/api/internal/run-scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ targetDate: date }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setState('error');
        setMessage(data.error ?? `HTTP ${res.status}`);
        return;
      }
      if (data.idleReason) {
        setState('done');
        setMessage(
          data.idleReason === 'no_earnings_on_session_date'
            ? `No watchlist tickers on ${date}`
            : `Skipped: ${data.idleReason}`
        );
        return;
      }
      setState('done');
      setMessage(`${data.count ?? 0} brief${data.count === 1 ? '' : 's'} generated`);
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
    <div className="flex items-center gap-2">
      <button
        type="button"
        disabled={state === 'running'}
        onClick={handleClick}
        className={`text-[10px] px-2 py-1 border tracking-widest transition-colors disabled:opacity-40 ${colorClass}`}
      >
        {state === 'running' ? '…' : state === 'done' ? '✓ PREPPED' : 'PREP'}
      </button>
      {message && (
        <span className={`text-[10px] ${state === 'error' ? 'text-signal-sell' : 'text-fg-muted'}`}>
          {message}
        </span>
      )}
    </div>
  );
}
