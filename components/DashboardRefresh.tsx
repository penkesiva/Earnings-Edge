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
    <div className="border border-border bg-bg-elevated px-4 py-3 text-sm">
      <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-2">
          <div className="text-xs text-fg-subtle tracking-widest uppercase">Earnings dates</div>
          <details className="group">
            <summary className="list-none cursor-pointer select-none text-[10px] px-1.5 py-0.5 border border-border-subtle text-fg-subtle hover:text-fg hover:border-fg-subtle tracking-widest">
              INFO
            </summary>
            <div className="absolute mt-2 max-w-xs sm:max-w-sm border border-border-subtle bg-bg-elevated px-2.5 py-2 text-xs text-fg-muted leading-relaxed z-10 shadow-md">
              Pulls upcoming earnings dates for all active watchlist tickers from FMP (30-day
              window). Run this after adding new tickers or when dates look stale on the dashboard.
            </div>
          </details>
        </div>
        <button
          type="button"
          disabled={pending}
          onClick={run}
          className={`px-3 py-1.5 text-xs font-bold tracking-widest border transition-colors shrink-0 ${
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
          className={`mt-2 text-xs ${last.ok ? 'text-signal-buy' : 'text-signal-sell'}`}
          role="status"
        >
          {last.ok ? last.message : last.error}
        </p>
      ) : null}
    </div>
  );
}
