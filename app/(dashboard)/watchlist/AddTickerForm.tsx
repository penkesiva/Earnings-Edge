'use client';

import { useFormState, useFormStatus } from 'react-dom';
import { addTicker } from './actions';

function SubmitButton() {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      disabled={pending}
      className="w-full sm:w-auto bg-fg text-bg px-4 py-2 text-sm font-bold tracking-widest hover:bg-signal-buy transition-colors disabled:opacity-50 disabled:pointer-events-none touch-target"
    >
      {pending ? 'ADDING…' : 'ADD'}
    </button>
  );
}

export function AddTickerForm() {
  const [state, formAction] = useFormState(addTicker, {});

  return (
    <form action={formAction} className="border border-border bg-bg-elevated p-3 sm:p-4 space-y-3">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <div className="w-full min-w-0 sm:flex-1 sm:max-w-xs">
          <label className="text-xs text-fg-subtle tracking-widest block mb-1">TICKER</label>
          <input
            name="ticker"
            placeholder="NVDA"
            required
            className="w-full bg-bg border border-border px-3 py-2 text-sm font-mono uppercase focus:outline-none focus:border-signal-buy"
          />
        </div>
        <div className="w-full sm:w-auto shrink-0">
          <SubmitButton />
        </div>
      </div>
      {state?.error ? (
        <p className="text-xs text-signal-sell" role="alert">
          {state.error}
        </p>
      ) : null}
    </form>
  );
}
