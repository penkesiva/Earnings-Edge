'use client';

import { useFormState, useFormStatus } from 'react-dom';
import { addTicker } from './actions';

function SubmitButton() {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      disabled={pending}
      className="bg-fg text-bg px-4 py-2 text-sm font-bold tracking-widest hover:bg-signal-buy transition-colors disabled:opacity-50 disabled:pointer-events-none"
    >
      {pending ? 'ADDING…' : 'ADD'}
    </button>
  );
}

export function AddTickerForm() {
  const [state, formAction] = useFormState(addTicker, {});

  return (
    <form action={formAction} className="border border-border bg-bg-elevated p-4 space-y-3">
      <div className="flex gap-3 items-end flex-wrap">
        <div className="flex-1 min-w-[120px]">
          <label className="text-xs text-fg-subtle tracking-widest block mb-1">TICKER</label>
          <input
            name="ticker"
            placeholder="NVDA"
            required
            className="w-full bg-bg border border-border px-3 py-2 text-sm font-mono uppercase focus:outline-none focus:border-signal-buy"
          />
        </div>
        <div className="flex-[3] min-w-[200px]">
          <label className="text-xs text-fg-subtle tracking-widest block mb-1">THESIS</label>
          <input
            name="thesis"
            placeholder="NVDA optics partner — locked-in supply"
            className="w-full bg-bg border border-border px-3 py-2 text-sm focus:outline-none focus:border-signal-buy"
          />
        </div>
        <SubmitButton />
      </div>
      {state?.error ? (
        <p className="text-xs text-signal-sell" role="alert">
          {state.error}
        </p>
      ) : null}
    </form>
  );
}
