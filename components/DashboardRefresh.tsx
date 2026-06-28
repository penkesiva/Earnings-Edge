'use client';

import { useState } from 'react';
import { syncCalendarAction, type RefreshResult } from '@/app/actions/dashboard-refresh';

export function DashboardRefresh() {
  const [pending, setPending] = useState(false);
  const [last, setLast] = useState<RefreshResult | null>(null);

  async function run() {
    setLast(null);
    setPending(true);
    try {
      setLast(await syncCalendarAction());
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="w-full min-w-0 border panel-accent px-2.5 py-2.5 sm:px-4 sm:py-3 text-sm">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
        <div className="flex flex-wrap items-center gap-2 min-w-0">
          <div className="text-xs text-fg-subtle tracking-widest uppercase">Earnings dates</div>
          <details className="group relative">
            <summary className="list-none cursor-pointer select-none text-[10px] px-1.5 py-0.5 border border-border-subtle text-fg-subtle hover:text-fg hover:border-fg-subtle tracking-widest">
              INFO
            </summary>
            <div className="absolute left-0 top-full z-20 mt-2 w-[min(18rem,calc(100vw-2rem))] border border-border-subtle bg-bg-elevated px-3 py-2.5 text-xs text-fg-muted leading-relaxed shadow-md">
              Pulls upcoming earnings dates for all active watchlist tickers from FMP (30-day
              window). Run this after adding new tickers or when dates look stale on the dashboard.
            </div>
          </details>
        </div>
        <button
          type="button"
          disabled={pending}
          onClick={run}
          className={`w-full sm:w-auto touch-target px-3 py-2 sm:py-1.5 text-xs font-bold tracking-widest border transition-colors shrink-0 ${
            pending
              ? 'border-signal-buy text-signal-buy animate-pulse cursor-not-allowed'
              : 'border-border bg-bg hover:border-signal-buy hover:text-signal-buy'
          }`}
        >
          {pending ? 'SYNCING…' : 'SYNC CALENDAR'}
        </button>
      </div>
      {last ? (
        <p
          className={`mt-2 text-xs break-words ${last.ok ? 'text-signal-buy' : 'text-signal-sell'}`}
          role="status"
        >
          {last.ok ? last.message : last.error}
        </p>
      ) : null}
    </div>
  );
}
