'use client';

import { useState } from 'react';
import { syncCalendarAction, type RefreshResult } from '@/app/actions/dashboard-refresh';

async function callRunScan(prep?: 'tomorrow'): Promise<RefreshResult> {
  const res = await fetch('/api/internal/run-scan', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(prep ? { prep } : {}),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    return { ok: false, error: data.error ?? `HTTP ${res.status}` };
  }
  const count: number | undefined = data.count;
  const idle: string | undefined = data.idleReason;
  if (idle === 'empty_watchlist') {
    return { ok: true, message: 'Watchlist is empty — add tickers on WATCHLIST first.' };
  }
  if (idle) {
    return { ok: true, message: `No earnings today (${idle}).` };
  }
  const label = prep === 'tomorrow' ? 'Tomorrow prep' : 'Daily scan';
  return { ok: true, message: `${label} finished (${count ?? 0} ticker${count === 1 ? '' : 's'}).` };
}

export function DashboardRefresh() {
  const [pending, setPending] = useState(false);
  const [last, setLast] = useState<RefreshResult | null>(null);

  async function run(fn: () => Promise<RefreshResult>) {
    setLast(null);
    setPending(true);
    try {
      setLast(await fn());
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="border border-border bg-bg-elevated px-4 py-3 text-sm">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <div className="text-xs text-fg-subtle tracking-widest uppercase">
              Data refresh
            </div>
            <details className="group">
              <summary className="list-none cursor-pointer select-none text-[10px] px-1.5 py-0.5 border border-border-subtle text-fg-subtle hover:text-fg hover:border-fg-subtle tracking-widest">
                INFO
              </summary>
              <div className="mt-2 max-w-xl border border-border-subtle bg-bg px-2.5 py-2 text-xs text-fg-muted leading-relaxed">
                <span className="text-fg">Sync calendar</span> refreshes upcoming dates for your
                watchlist (30-day pull from FMP; the board below shows{' '}
                <span className="text-fg-subtle">NEXT 7 DAYS</span>).{' '}
                <span className="text-fg">Daily scan</span> only runs for names with{' '}
                <span className="text-fg-subtle">earnings on today&apos;s US session date</span>{' '}
                (needs Alpaca + FMP). Use{' '}
                <span className="text-fg-subtle">PREP TOMORROW</span> for day-ahead briefs.
              </div>
            </details>
          </div>
        </div>
        <div className="grid grid-cols-1 sm:flex sm:flex-wrap gap-2 shrink-0 w-full sm:w-auto">
          <button
            type="button"
            disabled={pending}
            onClick={() => run(syncCalendarAction)}
            className="px-3 py-2 text-xs font-bold tracking-widest border border-border bg-bg hover:border-signal-buy hover:text-signal-buy transition-colors disabled:opacity-40 w-full sm:w-auto"
          >
            {pending ? '…' : 'SYNC CALENDAR'}
          </button>
          <button
            type="button"
            disabled={pending}
            onClick={() => run(() => callRunScan())}
            className="px-3 py-2 text-xs font-bold tracking-widest bg-fg text-bg hover:bg-signal-buy transition-colors disabled:opacity-40 w-full sm:w-auto"
          >
            {pending ? '…' : 'RUN DAILY SCAN'}
          </button>
          <button
            type="button"
            disabled={pending}
            onClick={() => run(() => callRunScan('tomorrow'))}
            className="px-3 py-2 text-xs font-bold tracking-widest border border-border bg-bg hover:border-signal-watch hover:text-signal-watch transition-colors disabled:opacity-40 w-full sm:w-auto"
          >
            {pending ? '…' : 'PREP TOMORROW'}
          </button>
        </div>
      </div>
      {last ? (
        <p
          className={`mt-3 text-xs ${last.ok ? 'text-signal-buy' : 'text-signal-sell'}`}
          role="status"
        >
          {last.ok ? last.message : last.error}
        </p>
      ) : null}
    </div>
  );
}
