'use client';

import { useFormState, useFormStatus } from 'react-dom';
import { batchImport, type BatchImportResult } from './actions';

const PLACEHOLDER = `1. HD  | May 19, 2026 | BMO
2. TGT | May 20, 2026 | BMO
3. NVDA | May 20, 2026 | AMC`;

function SubmitBtn() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="w-full sm:w-auto touch-target bg-fg text-bg px-4 py-2 text-xs font-bold tracking-widest hover:bg-signal-buy transition-colors disabled:opacity-50"
    >
      {pending ? 'IMPORTING…' : 'IMPORT ALL'}
    </button>
  );
}

function ResultBlock({ result }: { result: BatchImportResult }) {
  return (
    <div className="space-y-2 text-xs font-mono">
      {result.added.length > 0 && (
        <div>
          <div className="text-signal-buy mb-1">
            ✓ {result.added.length} ticker{result.added.length === 1 ? '' : 's'} added / updated
          </div>
          <ul className="pl-3 space-y-0.5 text-fg-muted">
            {result.added.map((r, i) => <li key={i}>· {r}</li>)}
          </ul>
        </div>
      )}
      {result.errors.length > 0 && (
        <div>
          <div className="text-signal-sell mb-1">⚠ {result.errors.length} parse error(s)</div>
          <ul className="pl-3 space-y-0.5 text-fg-dim">
            {result.errors.map((e, i) => <li key={i}>· {e}</li>)}
          </ul>
        </div>
      )}
    </div>
  );
}

export function BatchImportForm() {
  const [state, formAction] = useFormState(batchImport, {});

  return (
    <details className="group border border-border bg-bg-elevated">
      <summary className="cursor-pointer px-3 sm:px-4 py-3 text-xs tracking-widest text-fg-subtle flex items-center justify-between gap-2 select-none min-w-0">
        <span className="min-w-0 leading-snug">BATCH IMPORT — paste a schedule</span>
        <span className="text-fg-dim group-open:rotate-180 transition-transform">▾</span>
      </summary>

      <form action={formAction} className="border-t border-border-subtle px-4 pb-4 pt-3 space-y-3">
        <p className="text-[11px] text-fg-dim leading-relaxed">
          Paste any format with ticker, date, and optional AMC/BMO — pipe, tab, comma, or
          multi-space delimiters all work. Numbered lists (1. HD, 2) TGT) are fine — the
          number is stripped automatically. Tickers are added to watchlist and earnings calendar
          in one shot.
        </p>

        <textarea
          name="lines"
          rows={8}
          spellCheck={false}
          placeholder={PLACEHOLDER}
          className="w-full bg-bg border border-border px-3 py-2 text-sm font-mono focus:outline-none focus:border-signal-buy resize-y"
        />

        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
          <SubmitBtn />
          {state.error && (
            <p className="text-xs text-signal-sell whitespace-pre-wrap min-w-0">{state.error}</p>
          )}
        </div>

        {state.result && <ResultBlock result={state.result} />}
      </form>
    </details>
  );
}
