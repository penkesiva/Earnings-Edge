'use client';

import { useFormState, useFormStatus } from 'react-dom';
import { addTicker } from './actions';

const FIELD =
  'h-11 sm:h-10 box-border bg-bg border border-border px-3 text-base sm:text-sm focus:outline-none focus:border-signal-buy';

function SubmitButton() {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      disabled={pending}
      className={`${FIELD} shrink-0 w-auto min-w-[4.75rem] px-4 font-bold tracking-widest bg-fg text-bg border-fg hover:bg-signal-buy hover:border-signal-buy transition-colors disabled:opacity-50 disabled:pointer-events-none flex items-center justify-center touch-target`}
    >
      {pending ? 'ADDING…' : 'ADD'}
    </button>
  );
}

export function AddTickerForm() {
  const [state, formAction] = useFormState(addTicker, {});

  return (
    <form action={formAction} className="border border-border bg-bg-elevated p-2.5 sm:p-4 space-y-2.5">
      <div className="w-full min-w-0 sm:max-w-lg">
        <label className="text-xs text-fg-subtle tracking-widest block mb-1.5">TICKER</label>
        <div className="flex gap-2 items-stretch w-full min-w-0">
          <input
            name="ticker"
            placeholder="NVDA"
            required
            autoCapitalize="characters"
            autoCorrect="off"
            spellCheck={false}
            className={`${FIELD} flex-1 min-w-0 basis-0 font-mono uppercase`}
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
