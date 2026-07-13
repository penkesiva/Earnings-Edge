'use client';

import { useState, useTransition } from 'react';
import type { EarningsCandidateRow } from '@/lib/earningsDiscovery';
import { discoveryFilterSummary } from '@/lib/earningsDiscoveryFilter';
import {
  addAllDiscoveryCandidatesAction,
  addDiscoveryCandidateAction,
  dismissDiscoveryCandidateAction,
  fetchUpcomingEarningsAction,
  type DiscoveryActionState,
} from './actions';

function formatMarketCap(value: number | null): string {
  if (value == null) return '—';
  if (value >= 1_000_000_000_000) return `$${(value / 1_000_000_000_000).toFixed(1)}T`;
  if (value >= 1_000_000_000) return `$${(value / 1_000_000_000).toFixed(1)}B`;
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(0)}M`;
  return `$${value.toFixed(0)}`;
}

function TimingBadge({ timing }: { timing: string }) {
  if (timing === 'BMO') {
    return <span className="text-[10px] font-bold tracking-widest px-1 py-0.5 border timing-bmo">BMO</span>;
  }
  if (timing === 'AMC') {
    return <span className="text-[10px] font-bold tracking-widest px-1 py-0.5 border timing-amc">AMC</span>;
  }
  return <span className="text-[10px] text-fg-dim">UNK</span>;
}

function CandidateRow({ row }: { row: EarningsCandidateRow }) {
  const [pending, startTransition] = useTransition();

  function run(action: (fd: FormData) => Promise<void>) {
    const fd = new FormData();
    fd.set('candidate_id', row.id);
    startTransition(() => void action(fd));
  }

  return (
    <div
      className={`grid grid-cols-12 gap-2 sm:gap-3 px-3 sm:px-4 py-3 text-sm items-center border-b border-border-subtle ${
        pending ? 'opacity-60' : ''
      }`}
    >
      <div className="col-span-3 sm:col-span-2 font-bold">{row.ticker}</div>
      <div className="col-span-5 sm:col-span-4 min-w-0 truncate text-fg-muted" title={row.company_name ?? ''}>
        {row.company_name ?? '—'}
      </div>
      <div className="col-span-2 sm:col-span-2 text-xs tabular-nums">{row.earnings_date}</div>
      <div className="hidden sm:block sm:col-span-1">
        <TimingBadge timing={row.timing} />
      </div>
      <div className="hidden md:block md:col-span-1 text-xs text-fg-dim tabular-nums">
        {formatMarketCap(row.market_cap)}
      </div>
      <div className="col-span-4 sm:col-span-3 flex gap-1.5 justify-end">
        <button
          type="button"
          disabled={pending}
          onClick={() => run(addDiscoveryCandidateAction)}
          className="brief-action-btn brief-action-btn--save text-[10px]"
        >
          ADD
        </button>
        <button
          type="button"
          disabled={pending}
          onClick={() => run(dismissDiscoveryCandidateAction)}
          className="brief-action-btn text-[10px] text-fg-dim hover:text-signal-sell"
        >
          DISMISS
        </button>
      </div>
    </div>
  );
}

export function EarningsDiscoveryPanel({
  candidates,
}: {
  candidates: EarningsCandidateRow[];
}) {
  const [message, setMessage] = useState<DiscoveryActionState | null>(null);
  const [fetching, startFetch] = useTransition();
  const [addingAll, startAddAll] = useTransition();

  function onFetch() {
    setMessage(null);
    startFetch(async () => {
      const res = await fetchUpcomingEarningsAction();
      setMessage(res);
    });
  }

  function onAddAll() {
    startAddAll(async () => {
      await addAllDiscoveryCandidatesAction();
    });
  }

  return (
    <section className="border panel-accent divide-y divide-border-subtle">
      <div className="px-3 sm:px-4 py-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-sm font-bold tracking-wide">Upcoming earnings (14 days)</h2>
          <p className="text-xs text-fg-subtle mt-1">{discoveryFilterSummary()}</p>
        </div>
        <div className="flex flex-wrap gap-2 shrink-0">
          <button
            type="button"
            disabled={fetching}
            onClick={onFetch}
            className={`touch-target px-3 py-2 text-xs font-bold tracking-widest border transition-colors ${
              fetching
                ? 'border-accent text-accent animate-pulse cursor-wait'
                : 'border-accent text-accent hover:bg-accent-muted'
            }`}
          >
            {fetching ? 'FETCHING…' : 'FETCH EARNINGS'}
          </button>
          {candidates.length > 0 ? (
            <button
              type="button"
              disabled={addingAll || fetching}
              onClick={onAddAll}
              className="touch-target px-3 py-2 text-xs tracking-widest border border-border text-fg-muted hover:border-fg-subtle hover:text-fg"
            >
              {addingAll ? 'ADDING…' : 'ADD ALL'}
            </button>
          ) : null}
        </div>
      </div>

      {message?.error ? (
        <p className="px-3 sm:px-4 py-2 text-xs text-signal-sell" role="alert">
          {message.error}
        </p>
      ) : null}
      {message?.success ? (
        <p className="px-3 sm:px-4 py-2 text-xs text-signal-buy" role="status">
          {message.success}
        </p>
      ) : null}

      {candidates.length === 0 ? (
        <p className="px-3 sm:px-4 py-6 text-sm text-fg-subtle text-center">
          Press <span className="text-fg font-medium">FETCH EARNINGS</span> to load filtered names.
          Dismissed tickers stay hidden on refetch.
        </p>
      ) : (
        <div>
          <div className="grid grid-cols-12 gap-2 sm:gap-3 px-3 sm:px-4 py-2 text-[10px] text-fg-subtle uppercase tracking-widest table-head-accent">
            <div className="col-span-3 sm:col-span-2">TKR</div>
            <div className="col-span-5 sm:col-span-4">NAME</div>
            <div className="col-span-2 sm:col-span-2">DATE</div>
            <div className="hidden sm:block sm:col-span-1">WHEN</div>
            <div className="hidden md:block md:col-span-1">CAP</div>
            <div className="col-span-4 sm:col-span-3 text-right">ACTION</div>
          </div>
          {candidates.map(row => (
            <CandidateRow key={row.id} row={row} />
          ))}
        </div>
      )}
    </section>
  );
}
