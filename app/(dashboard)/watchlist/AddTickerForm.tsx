'use client';

import { useFormState, useFormStatus } from 'react-dom';
import { addTicker } from './actions';

const FIELD =
  'h-10 box-border bg-bg border border-border px-3 text-sm focus:outline-none focus:border-signal-buy';

function SubmitButton() {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      disabled={pending}
      className={`${FIELD} w-full sm:w-auto shrink-0 px-4 font-bold tracking-widest bg-fg text-bg border-fg hover:bg-signal-buy hover:border-signal-buy transition-colors disabled:opacity-50 disabled:pointer-events-none flex items-center justify-center`}
    >
      {pending ? 'ADDING…' : 'ADD'}
    </button>
  );
}

export function AddTickerForm() {
  const [state, formAction] = useFormState(addTicker, {});

  return (
    <form action={formAction} className="border border-border bg-bg-elevated p-3 sm:p-4 space-y-3">
      <div className="w-full min-w-0 sm:max-w-md">
        <label className="text-xs text-fg-subtle tracking-widest block mb-1">TICKER</label>
        <div className="flex gap-2 items-stretch">
          <input
            name="ticker"
            placeholder="NVDA"
            required
            className={`${FIELD} flex-1 min-w-0 font-mono uppercase`}
          />
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
