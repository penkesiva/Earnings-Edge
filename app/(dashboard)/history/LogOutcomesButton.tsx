'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export function LogOutcomesButton({ pendingCount }: { pendingCount: number }) {
  const router = useRouter();
  const [state, setState] = useState<'idle' | 'running' | 'done' | 'error'>('idle');
  const [message, setMessage] = useState('');

  async function handleClick() {
    setState('running');
    setMessage('');
    try {
      const res = await fetch('/api/internal/log-outcomes', { method: 'POST' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setState('error');
        setMessage(data.error ?? `HTTP ${res.status}`);
        return;
      }
      if (data.count === 0) {
        setState('done');
        setMessage(data.message ?? 'No pending outcomes to log.');
        return;
      }
      const ok    = data.results?.filter((r: any) => r.status === 'ok').length ?? 0;
      const errs  = data.results?.filter((r: any) => r.status === 'error').length ?? 0;
      setState('done');
      setMessage(`${ok} outcome${ok === 1 ? '' : 's'} logged${errs ? `, ${errs} error(s)` : ''}.`);
      router.refresh();
    } catch {
      setState('error');
      setMessage('Network error');
    }
  }

  const colorClass =
    state === 'done'  ? 'border-signal-buy text-signal-buy' :
    state === 'error' ? 'border-signal-sell text-signal-sell' :
    'border-border text-fg-subtle hover:border-signal-watch hover:text-signal-watch';

  return (
    <div className="flex items-center gap-3 shrink-0">
      <button
        type="button"
        disabled={state === 'running'}
        onClick={handleClick}
        className={`px-3 py-2 text-xs font-bold tracking-widest border transition-colors disabled:opacity-40 ${colorClass}`}
      >
        {state === 'running' ? 'FETCHING…' : state === 'done' ? '✓ OUTCOMES LOGGED' : `LOG OUTCOMES${pendingCount > 0 ? ` (${pendingCount})` : ''}`}
      </button>
      {message && (
        <span className={`text-xs ${state === 'error' ? 'text-signal-sell' : 'text-fg-muted'}`}>
          {message}
        </span>
      )}
    </div>
  );
}
