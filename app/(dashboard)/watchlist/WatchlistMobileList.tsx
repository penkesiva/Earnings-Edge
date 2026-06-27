'use client';

import { useRef, useState, useTransition } from 'react';
import { useFormStatus } from 'react-dom';
import { deleteTicker, setManualEarnings } from './actions';

export type WatchlistMobileRow = {
  id: string;
  ticker: string;
  active: boolean;
  manual_earnings_date: string | null;
  manual_timing: string | null;
};

const REVEAL_PX = 72;
const FULL_DELETE_RATIO = 0.62;

const FIELD =
  'h-9 box-border bg-bg border border-border px-2 text-xs focus:outline-none focus:border-signal-buy';

function isSwipeInteractive(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return !!target.closest('input, select, button, textarea, label, a');
}

function SaveButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className={`${FIELD} shrink-0 px-2.5 font-bold tracking-widest bg-fg text-bg border-fg hover:bg-signal-buy hover:border-signal-buy transition-colors disabled:opacity-50 touch-target`}
    >
      {pending ? '…' : 'SAVE'}
    </button>
  );
}

function WatchlistMobileCard({ row }: { row: WatchlistMobileRow }) {
  const shellRef = useRef<HTMLDivElement>(null);
  const deleteFormRef = useRef<HTMLFormElement>(null);
  const startX = useRef(0);
  const startY = useRef(0);
  const startOffset = useRef(0);
  const dragAxis = useRef<'none' | 'x' | 'y'>('none');
  const [offset, setOffset] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [deletePending, startDelete] = useTransition();

  function cardWidth() {
    return shellRef.current?.clientWidth ?? 320;
  }

  function clampOffset(value: number) {
    return Math.max(-cardWidth(), Math.min(0, value));
  }

  function snapOffset(current: number) {
    const width = cardWidth();
    if (current <= -width * FULL_DELETE_RATIO) {
      startDelete(() => {
        deleteFormRef.current?.requestSubmit();
      });
      return 0;
    }
    if (current <= -REVEAL_PX / 2) return -REVEAL_PX;
    return 0;
  }

  function onPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    if (isSwipeInteractive(e.target)) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    startX.current = e.clientX;
    startY.current = e.clientY;
    startOffset.current = offset;
    dragAxis.current = 'none';
    setDragging(true);
    e.currentTarget.setPointerCapture(e.pointerId);
  }

  function onPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    if (!dragging) return;

    const dx = e.clientX - startX.current;
    const dy = e.clientY - startY.current;

    if (dragAxis.current === 'none') {
      if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
      dragAxis.current = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y';
      if (dragAxis.current === 'y') {
        setDragging(false);
        if (e.currentTarget.hasPointerCapture(e.pointerId)) {
          e.currentTarget.releasePointerCapture(e.pointerId);
        }
        return;
      }
    }

    if (dragAxis.current !== 'x') return;

    const next = clampOffset(startOffset.current + dx);
    setOffset(next);
  }

  function finishDrag(e: React.PointerEvent<HTMLDivElement>) {
    if (!dragging) return;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
    const wasHorizontal = dragAxis.current === 'x';
    dragAxis.current = 'none';
    setDragging(false);
    if (wasHorizontal) {
      setOffset(prev => snapOffset(prev));
    }
  }

  function resetSwipe() {
    setOffset(0);
  }

  const timingLabel =
    row.manual_timing === 'BMO' || row.manual_timing === 'AMC' || row.manual_timing === 'UNK'
      ? row.manual_timing
      : null;

  return (
    <div ref={shellRef} className="relative overflow-hidden border border-border bg-bg-elevated touch-pan-y">
      <div
        className="absolute inset-y-0 right-0 flex items-stretch"
        style={{ width: REVEAL_PX }}
        aria-hidden={offset > -12}
      >
        <button
          type="button"
          disabled={deletePending}
          onClick={() => {
            startDelete(() => {
              deleteFormRef.current?.requestSubmit();
            });
          }}
          className="w-full bg-signal-sell text-bg text-[11px] font-bold tracking-widest disabled:opacity-50 touch-target"
        >
          {deletePending ? '…' : 'DEL'}
        </button>
      </div>

      <form ref={deleteFormRef} action={deleteTicker} className="hidden" aria-hidden>
        <input type="hidden" name="id" value={row.id} />
      </form>

      <div
        className={`relative bg-bg-elevated ${dragging ? '' : 'transition-transform duration-200 ease-out'}`}
        style={{ transform: `translate3d(${offset}px, 0, 0)` }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={finishDrag}
        onPointerCancel={finishDrag}
      >
        <div
          className={`px-2.5 py-2 ${row.active ? '' : 'opacity-55'}`}
          onClick={() => {
            if (offset < 0) resetSwipe();
          }}
        >
          <div className="flex items-center gap-2 min-w-0 mb-1.5">
            <div className="font-bold text-base tracking-tight shrink-0">{row.ticker}</div>
            {!row.active ? (
              <span className="text-[10px] text-fg-dim tracking-widest shrink-0">OFF</span>
            ) : timingLabel ? (
              <span className="text-[10px] text-fg-muted tracking-widest shrink-0">{timingLabel}</span>
            ) : null}
            {row.manual_earnings_date ? (
              <span className="text-[10px] text-fg-dim font-mono truncate min-w-0">
                {row.manual_earnings_date}
              </span>
            ) : (
              <span className="text-[10px] text-fg-dim truncate min-w-0">No manual ER date</span>
            )}
          </div>

          <form action={setManualEarnings} className="flex items-center gap-1.5 min-w-0">
            <input type="hidden" name="id" value={row.id} />
            <input
              type="date"
              name="manual_earnings_date"
              defaultValue={row.manual_earnings_date ?? ''}
              key={`${row.id}-${row.manual_earnings_date ?? 'no-date'}`}
              className={`${FIELD} min-w-0 flex-1`}
            />
            <select
              name="manual_timing"
              defaultValue={row.manual_timing ?? ''}
              key={`${row.id}-${row.manual_timing ?? 'no-timing'}`}
              className={`${FIELD} shrink-0 w-[3.6rem] px-1`}
            >
              <option value="">--</option>
              <option value="BMO">BMO</option>
              <option value="AMC">AMC</option>
              <option value="UNK">UNK</option>
            </select>
            <SaveButton />
          </form>
        </div>
      </div>
    </div>
  );
}

export function WatchlistMobileList({ tickers }: { tickers: WatchlistMobileRow[] }) {
  if (!tickers.length) {
    return (
      <div className="px-3 py-6 text-center text-fg-subtle text-sm border border-border bg-bg-elevated">
        No tickers. Add one above.
      </div>
    );
  }

  return (
    <div className="md:hidden space-y-1.5">
      <p className="text-[10px] text-fg-dim tracking-wide px-0.5">
        Swipe left a little for delete · swipe far to remove
      </p>
      {tickers.map(row => (
        <WatchlistMobileCard key={row.id} row={row} />
      ))}
    </div>
  );
}
