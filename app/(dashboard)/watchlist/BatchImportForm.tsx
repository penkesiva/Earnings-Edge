'use client';

import { useFormState, useFormStatus } from 'react-dom';
import { batchImport, type BatchImportResult } from './actions';

const PLACEHOLDER = `PBR  | Mon May 11 | AMC
CEG  | Mon May 11 | BMO
ALC  | Tue May 12 | BMO
JD   | Tue May 12 | BMO
CSCO | Wed May 13 | AMC
AMAT | Thu May 14 | AMC`;

function SubmitBtn() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="bg-fg text-bg px-4 py-2 text-xs font-bold tracking-widest hover:bg-signal-buy transition-colors disabled:opacity-50"
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
      <summary className="cursor-pointer px-4 py-3 text-xs tracking-widest text-fg-subtle flex items-center justify-between select-none">
        <span>BATCH IMPORT — paste a schedule</span>
        <span className="text-fg-dim group-open:rotate-180 transition-transform">▾</span>
      </summary>

      <form action={formAction} className="border-t border-border-subtle px-4 pb-4 pt-3 space-y-3">
        <p className="text-[11px] text-fg-dim leading-relaxed">
          Paste any format with ticker, date, and optional AMC/BMO — pipe, tab, comma, or
          multi-space delimiters all work. Tickers are added to watchlist and earnings calendar
          in one shot.
        </p>

        <textarea
          name="lines"
          rows={8}
          spellCheck={false}
          placeholder={PLACEHOLDER}
          className="w-full bg-bg border border-border px-3 py-2 text-sm font-mono focus:outline-none focus:border-signal-buy resize-y"
        />

        <div className="flex items-center justify-between gap-4 flex-wrap">
          <SubmitBtn />
          {state.error && (
            <p className="text-xs text-signal-sell whitespace-pre-wrap">{state.error}</p>
          )}
        </div>

        {state.result && <ResultBlock result={state.result} />}
      </form>
    </details>
  );
}
