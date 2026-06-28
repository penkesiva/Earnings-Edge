'use client';

import { useMemo } from 'react';
import { useFormState, useFormStatus } from 'react-dom';
import type { AlpacaAccountSummary } from '@/lib/alpacaCredentials';
import {
  removeAlpacaAccountAction,
  saveAlpacaAccountAction,
  setAlpacaTradeDefaultAction,
  type AlpacaSettingsState,
} from '@/app/(dashboard)/settings/actions';

const FIELD =
  'w-full h-10 box-border bg-bg border border-border px-3 text-sm font-mono focus:outline-none focus:border-accent';

function SubmitButton({
  label,
  pendingLabel,
  variant = 'primary',
}: {
  label: string;
  pendingLabel: string;
  variant?: 'primary' | 'danger' | 'ghost';
}) {
  const { pending } = useFormStatus();
  const className =
    variant === 'danger'
      ? `${FIELD} h-9 w-auto px-3 text-xs tracking-widest border-signal-sell text-signal-sell hover:bg-signal-sell/10`
      : variant === 'ghost'
        ? `${FIELD} h-9 w-auto px-3 text-xs tracking-widest text-fg-muted hover:border-fg-subtle`
        : `${FIELD} h-9 w-auto px-3 text-xs font-bold tracking-widest border-accent text-accent hover:bg-accent-muted`;

  return (
    <button type="submit" disabled={pending} className={className}>
      {pending ? pendingLabel : label}
    </button>
  );
}

function AccountCard({ summary }: { summary: AlpacaAccountSummary }) {
  const [state, saveAction] = useFormState(saveAlpacaAccountAction, {});
  const [removeState, removeAction] = useFormState(removeAlpacaAccountAction, {});
  const message = useMemo(() => {
    if (state.error) return { text: state.error, ok: false };
    if (state.success) return { text: state.success, ok: true };
    if (removeState.error) return { text: removeState.error, ok: false };
    if (removeState.success) return { text: removeState.success, ok: true };
    return null;
  }, [state, removeState]);

  const title = summary.environment === 'paper' ? 'Paper trading' : 'Live trading';
  const hint =
    summary.environment === 'paper'
      ? 'Alpaca paper keys — safe for testing strategies.'
      : 'Real money. Double-check keys before saving.';

  return (
    <section className="border border-border bg-bg-elevated divide-y divide-border-subtle">
      <div className="px-4 py-3 flex items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-bold tracking-wide">{title}</h2>
          <p className="text-xs text-fg-subtle mt-1">{hint}</p>
        </div>
        {summary.configured ? (
          <span className="text-[10px] tracking-widest uppercase px-2 py-1 border border-signal-buy/40 text-signal-buy bg-signal-buy/10 shrink-0">
            Connected
          </span>
        ) : (
          <span className="text-[10px] tracking-widest uppercase px-2 py-1 border border-border-subtle text-fg-dim shrink-0">
            Not set
          </span>
        )}
      </div>

      {summary.configured ? (
        <div className="px-4 py-3 text-xs text-fg-subtle space-y-1">
          <p>
            Key: <span className="font-mono text-fg">{summary.keyHint}</span>
          </p>
          {summary.accountStatus ? (
            <p>
              Status: <span className="text-fg">{summary.accountStatus}</span>
            </p>
          ) : null}
          {summary.verifiedAt ? (
            <p className="text-fg-dim">
              Verified {new Date(summary.verifiedAt).toLocaleString()}
            </p>
          ) : null}
        </div>
      ) : null}

      <form action={saveAction} className="px-4 py-4 space-y-3">
        <input type="hidden" name="environment" value={summary.environment} />
        <div>
          <label className="text-[10px] text-fg-dim tracking-widest uppercase block mb-1.5">
            API Key ID
          </label>
          <input
            name="api_key_id"
            required={!summary.configured}
            autoComplete="off"
            spellCheck={false}
            placeholder="PK..."
            className={FIELD}
          />
        </div>
        <div>
          <label className="text-[10px] text-fg-dim tracking-widest uppercase block mb-1.5">
            API Secret
          </label>
          <input
            name="api_secret"
            type="password"
            required={!summary.configured}
            autoComplete="new-password"
            spellCheck={false}
            placeholder={summary.configured ? 'Leave blank to keep current secret' : 'Secret key'}
            className={FIELD}
          />
        </div>
        <div className="flex flex-wrap gap-2 pt-1">
          <SubmitButton label="SAVE & VERIFY" pendingLabel="VERIFYING…" />
        </div>
        {message ? (
          <p
            className={`text-xs ${message.ok ? 'text-signal-buy' : 'text-signal-sell'}`}
            role="status"
          >
            {message.text}
          </p>
        ) : null}
      </form>

      {summary.configured ? (
        <form action={removeAction} className="px-4 py-3">
          <input type="hidden" name="environment" value={summary.environment} />
          <SubmitButton label="REMOVE" pendingLabel="REMOVING…" variant="danger" />
        </form>
      ) : null}
    </section>
  );
}

function TradeDefaultPicker({ summaries }: { summaries: AlpacaAccountSummary[] }) {
  const [state, setDefaultAction] = useFormState(setAlpacaTradeDefaultAction, {});
  const configured = summaries.filter(s => s.configured);
  const current = summaries.find(s => s.isTradeDefault)?.environment ?? 'none';

  if (!configured.length) return null;

  return (
    <section className="border panel-accent divide-y divide-border-subtle">
      <div className="px-4 py-3 bg-bg-elevated text-xs text-fg-subtle uppercase tracking-widest">
        Default for trading & scans
      </div>
      <form action={setDefaultAction} className="px-4 py-4 space-y-3">
        <p className="text-sm text-fg-subtle">
          Scans and future automated trades use this account&apos;s Alpaca keys when both are saved.
        </p>
        <div className="flex flex-wrap gap-4 text-sm">
          <label className="inline-flex items-center gap-2 cursor-pointer">
            <input type="radio" name="environment" value="none" defaultChecked={current === 'none'} />
            <span>No default</span>
          </label>
          {configured.map(s => (
            <label key={s.environment} className="inline-flex items-center gap-2 cursor-pointer">
              <input
                type="radio"
                name="environment"
                value={s.environment}
                defaultChecked={current === s.environment}
              />
              <span className="capitalize">{s.environment}</span>
            </label>
          ))}
        </div>
        <SubmitButton label="SET DEFAULT" pendingLabel="SAVING…" variant="ghost" />
        {state.error ? (
          <p className="text-xs text-signal-sell" role="alert">
            {state.error}
          </p>
        ) : null}
        {state.success ? (
          <p className="text-xs text-signal-buy" role="status">
            {state.success}
          </p>
        ) : null}
      </form>
    </section>
  );
}

export function AlpacaAccountsPanel({ summaries }: { summaries: AlpacaAccountSummary[] }) {
  const ordered = useMemo(
    () =>
      ['paper', 'live'].map(env => summaries.find(s => s.environment === env)!),
    [summaries],
  );

  return (
    <div className="space-y-4">
      <div className="text-sm text-fg-subtle space-y-2">
        <p>
          Keys are encrypted in Supabase and only used on the server. We verify each save against
          Alpaca before storing.
        </p>
        <p className="text-xs text-fg-dim">
          Get keys from{' '}
          <a
            href="https://app.alpaca.markets/paper/dashboard/overview"
            target="_blank"
            rel="noopener noreferrer"
            className="text-accent hover:underline"
          >
            Alpaca Paper
          </a>{' '}
          or{' '}
          <a
            href="https://app.alpaca.markets/dashboard/overview"
            target="_blank"
            rel="noopener noreferrer"
            className="text-accent hover:underline"
          >
            Alpaca Live
          </a>
          .
        </p>
      </div>

      {ordered.map(summary => (
        <AccountCard key={summary.environment} summary={summary} />
      ))}

      <TradeDefaultPicker summaries={summaries} />
    </div>
  );
}
