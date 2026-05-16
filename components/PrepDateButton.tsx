'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';

type State = 'idle' | 'running' | 'done' | 'error';

export function PrepDateButton({ date }: { date: string }) {
  const router = useRouter();
  const [state, setState] = useState<State>('idle');
  const [message, setMessage] = useState('');

  // Auto-reset the done/error state after 5 s so the button goes back to PREP.
  useEffect(() => {
    if (state !== 'done' && state !== 'error') return;
    const t = setTimeout(() => {
      setState('idle');
      setMessage('');
    }, 5000);
    return () => clearTimeout(t);
  }, [state]);

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
            : `Skipped: ${data.idleReason}`,
        );
        return;
      }
      setState('done');
      setMessage(`${data.count ?? 0} brief${data.count === 1 ? '' : 's'} generated`);
      router.refresh();
    } catch {
      setState('error');
      setMessage('Network error');
    }
  }

  const btnClass =
    state === 'running'
      ? 'border-signal-watch text-signal-watch animate-pulse cursor-not-allowed'
      : state === 'done'
        ? 'border-signal-buy text-signal-buy'
        : state === 'error'
          ? 'border-signal-sell text-signal-sell'
          : 'border-border text-fg-subtle hover:border-signal-watch hover:text-signal-watch transition-colors';

  const label =
    state === 'running' ? 'SCANNING…' :
    state === 'done'    ? '✓ PREPPED'  :
    state === 'error'   ? 'ERROR'      :
    'PREP';

  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        disabled={state === 'running'}
        onClick={handleClick}
        className={`touch-target text-[11px] font-bold px-2.5 py-2 sm:py-1 border tracking-widest ${btnClass}`}
      >
        {label}
      </button>
      {message && (
        <span
          className={`text-[10px] font-mono ${state === 'error' ? 'text-signal-sell' : 'text-fg-muted'}`}
          title={message}
        >
          {/* Truncate on mobile so it doesn't break the date header row */}
          <span className="hidden sm:inline">{message}</span>
          <span className="sm:hidden">{message.length > 20 ? message.slice(0, 18) + '…' : message}</span>
        </span>
      )}
    </div>
  );
}
