'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { useFormState, useFormStatus } from 'react-dom';
import { FinalVerdictBadge } from '@/components/FinalVerdictBadge';
import { DirectionIndicator } from '@/components/DirectionIndicator';
import type { AutomationSettings, TradeOrderRow } from '@/lib/automationSettings';
import type { GoTradeCandidate } from '@/lib/goTradeCandidates';
import {
  enableLiveTradingAction,
  runAutoTradeNowAction,
  toggleAutoTradeAction,
  toggleKillSwitchAction,
  updateMaxNotionalAction,
  type TradePageState,
} from '@/lib/tradePageActions';

const FIELD =
  'w-full h-10 box-border bg-bg border border-border px-3 text-sm font-mono focus:outline-none focus:border-accent';

function ActionButton({
  label,
  pendingLabel,
  variant = 'primary',
}: {
  label: string;
  pendingLabel: string;
  variant?: 'primary' | 'danger' | 'ghost';
}) {
  const { pending } = useFormStatus();
  const cls =
    variant === 'danger'
      ? `${FIELD} h-9 w-auto px-3 text-xs tracking-widest border-signal-sell text-signal-sell hover:bg-signal-sell/10`
      : variant === 'ghost'
        ? `${FIELD} h-9 w-auto px-3 text-xs tracking-widest text-fg-muted hover:border-fg-subtle`
        : `${FIELD} h-9 w-auto px-3 text-xs font-bold tracking-widest border-accent text-accent hover:bg-accent-muted`;

  return (
    <button type="submit" disabled={pending} className={cls}>
      {pending ? pendingLabel : label}
    </button>
  );
}

function StatusPill({
  label,
  tone,
}: {
  label: string;
  tone: 'ok' | 'warn' | 'off' | 'danger';
}) {
  const cls =
    tone === 'ok'
      ? 'border-signal-buy/40 text-signal-buy bg-signal-buy/10'
      : tone === 'warn'
        ? 'border-signal-watch/40 text-signal-watch bg-signal-watch/10'
        : tone === 'danger'
          ? 'border-signal-sell/40 text-signal-sell bg-signal-sell/10'
          : 'border-border-subtle text-fg-dim bg-bg-elevated';

  return (
    <span className={`text-[10px] tracking-widest uppercase px-2 py-1 border shrink-0 ${cls}`}>
      {label}
    </span>
  );
}

function FlashMessage({ state }: { state: TradePageState }) {
  const text = state.error ?? state.success;
  if (!text) return null;
  return (
    <p
      className={`text-xs px-3 py-2 border ${
        state.error
          ? 'border-signal-sell/40 text-signal-sell bg-signal-sell/5'
          : 'border-signal-buy/40 text-signal-buy bg-signal-buy/5'
      }`}
    >
      {text}
    </p>
  );
}

export function TradeAutomationPanel({
  settings,
  candidates,
  orders,
  paperConfigured,
  migrationRequired = false,
}: {
  settings: AutomationSettings;
  candidates: GoTradeCandidate[];
  orders: TradeOrderRow[];
  paperConfigured: boolean;
  migrationRequired?: boolean;
}) {
  const [autoState, autoAction] = useFormState(toggleAutoTradeAction, {});
  const [killState, killAction] = useFormState(toggleKillSwitchAction, {});
  const [liveState, liveAction] = useFormState(enableLiveTradingAction, {});
  const [notionalState, notionalAction] = useFormState(updateMaxNotionalAction, {});
  const [runState, runAction] = useFormState(runAutoTradeNowAction, {});
  const [showLiveConfirm, setShowLiveConfirm] = useState(false);

  const flash = useMemo(() => {
    return autoState.error || autoState.success
      ? autoState
      : killState.error || killState.success
        ? killState
        : liveState.error || liveState.success
          ? liveState
          : notionalState.error || notionalState.success
            ? notionalState
            : runState;
  }, [autoState, killState, liveState, notionalState, runState]);

  const accountMode = settings.liveTradingEnabled ? 'live' : 'paper';

  return (
    <div className="space-y-6">
      <FlashMessage state={flash} />

      {!paperConfigured ? (
        <div className="border border-signal-watch/40 bg-signal-watch/5 px-4 py-3 text-sm text-fg-subtle">
          Add{' '}
          <Link href="/settings" className="text-accent underline underline-offset-2">
            Paper Alpaca keys
          </Link>{' '}
          in Settings before running trades.
        </div>
      ) : null}

      <section
        className={`border panel-accent divide-y divide-border-subtle ${
          migrationRequired ? 'opacity-60 pointer-events-none' : ''
        }`}
      >
        <div className="px-4 py-3 flex flex-wrap items-center gap-2 justify-between bg-bg-elevated">
          <div>
            <h2 className="text-sm font-bold tracking-wide">Automation</h2>
            <p className="text-xs text-fg-subtle mt-1">
              Consensus GO only · directional equity orders · one per brief
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <StatusPill
              label={settings.autoTradeEnabled ? 'Auto ON' : 'Auto OFF'}
              tone={settings.autoTradeEnabled ? 'ok' : 'off'}
            />
            <StatusPill
              label={settings.killSwitch ? 'Kill ON' : 'Kill OFF'}
              tone={settings.killSwitch ? 'danger' : 'off'}
            />
            <StatusPill
              label={accountMode === 'paper' ? 'Paper only' : 'Live enabled'}
              tone={accountMode === 'paper' ? 'warn' : 'danger'}
            />
          </div>
        </div>

        <div className="px-4 py-4 grid sm:grid-cols-2 gap-4">
          <form action={autoAction} className="space-y-2">
            <p className="text-xs text-fg-dim uppercase tracking-widest">Auto-trade</p>
            <input type="hidden" name="enabled" value={String(!settings.autoTradeEnabled)} />
            <ActionButton
              label={settings.autoTradeEnabled ? 'Turn OFF' : 'Turn ON (paper)'}
              pendingLabel="Saving…"
              variant={settings.autoTradeEnabled ? 'ghost' : 'primary'}
            />
          </form>

          <form action={killAction} className="space-y-2">
            <p className="text-xs text-fg-dim uppercase tracking-widest">Kill switch</p>
            <input type="hidden" name="on" value={String(!settings.killSwitch)} />
            <ActionButton
              label={settings.killSwitch ? 'Release kill switch' : 'STOP all new orders'}
              pendingLabel="Saving…"
              variant={settings.killSwitch ? 'primary' : 'danger'}
            />
          </form>
        </div>

        <div className="px-4 py-4 border-t border-border-subtle">
          <form action={notionalAction} className="flex flex-col sm:flex-row gap-3 sm:items-end">
            <div className="flex-1 space-y-1">
              <label htmlFor="max_notional_usd" className="text-xs text-fg-dim uppercase tracking-widest">
                Max notional per trade (USD)
              </label>
              <input
                id="max_notional_usd"
                name="max_notional_usd"
                type="number"
                min={100}
                max={100000}
                step={100}
                defaultValue={settings.maxNotionalUsd}
                className={FIELD}
              />
            </div>
            <ActionButton label="Save" pendingLabel="Saving…" />
          </form>
        </div>

        <div className="px-4 py-4 border-t border-border-subtle space-y-3">
          <p className="text-xs text-fg-dim uppercase tracking-widest">Live trading (opt-in)</p>
          {settings.liveTradingEnabled ? (
            <form action={liveAction}>
              <input type="hidden" name="enable" value="false" />
              <input type="hidden" name="confirm" value="" />
              <ActionButton label="Disable live — paper only" pendingLabel="Saving…" variant="ghost" />
            </form>
          ) : showLiveConfirm ? (
            <form action={liveAction} className="space-y-2">
              <input type="hidden" name="enable" value="true" />
              <p className="text-xs text-signal-sell">
                Real money. Type <strong>ENABLE LIVE</strong> to confirm.
              </p>
              <input name="confirm" placeholder="ENABLE LIVE" className={FIELD} autoComplete="off" />
              <div className="flex gap-2">
                <ActionButton label="Confirm live" pendingLabel="Saving…" variant="danger" />
                <button
                  type="button"
                  onClick={() => setShowLiveConfirm(false)}
                  className={`${FIELD} h-9 w-auto px-3 text-xs tracking-widest text-fg-muted`}
                >
                  Cancel
                </button>
              </div>
            </form>
          ) : (
            <button
              type="button"
              onClick={() => setShowLiveConfirm(true)}
              className={`${FIELD} h-9 w-auto px-3 text-xs tracking-widest text-fg-muted hover:border-fg-subtle`}
            >
              Enable live trading…
            </button>
          )}
        </div>

        <div className="px-4 py-4 border-t border-border-subtle flex flex-col sm:flex-row sm:items-center gap-3 justify-between">
          <div>
            <p className="text-sm font-bold">{candidates.length} GO candidate(s)</p>
            <p className="text-xs text-fg-subtle mt-1">
              Active watchlist · earnings in next 2 trading days · not yet traded
            </p>
          </div>
          <form action={runAction}>
            <ActionButton
              label="Run now"
              pendingLabel="Placing orders…"
              variant="primary"
            />
          </form>
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-bold tracking-wide">
          <span className="page-chevron">›</span> GO QUEUE
        </h2>
        {candidates.length === 0 ? (
          <p className="text-xs text-fg-subtle border border-border px-4 py-6 text-center">
            No eligible trades. Run Scan All on upcoming briefs until consensus shows GO + direction.
          </p>
        ) : (
          <ul className="border border-border divide-y divide-border-subtle">
            {candidates.map(row => (
              <li key={row.briefId} className="px-4 py-3 flex items-center gap-3">
                <DirectionIndicator direction={row.direction} />
                <Link href={`/briefs/${row.briefId}`} className="font-bold text-sm hover:text-accent">
                  {row.ticker}
                </Link>
                <FinalVerdictBadge verdict="GO" direction={row.direction} />
                <span className="text-xs text-fg-dim tabular-nums ml-auto">
                  score {Math.round(row.compositeScore)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-bold tracking-wide">
          <span className="page-chevron">›</span> ORDER LOG
        </h2>
        {orders.length === 0 ? (
          <p className="text-xs text-fg-subtle border border-border px-4 py-6 text-center">
            No orders yet.
          </p>
        ) : (
          <div className="border border-border overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-bg-elevated text-fg-dim uppercase tracking-widest text-left">
                  <th className="px-3 py-2 font-medium">Time</th>
                  <th className="px-3 py-2 font-medium">Ticker</th>
                  <th className="px-3 py-2 font-medium">Side</th>
                  <th className="px-3 py-2 font-medium">Qty</th>
                  <th className="px-3 py-2 font-medium">Env</th>
                  <th className="px-3 py-2 font-medium">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border-subtle">
                {orders.map(order => (
                  <tr key={order.id} className="text-fg-subtle">
                    <td className="px-3 py-2 whitespace-nowrap tabular-nums">
                      {new Date(order.createdAt).toLocaleString(undefined, {
                        month: 'short',
                        day: 'numeric',
                        hour: 'numeric',
                        minute: '2-digit',
                      })}
                    </td>
                    <td className="px-3 py-2 font-bold text-fg">{order.ticker}</td>
                    <td className="px-3 py-2 uppercase">{order.side}</td>
                    <td className="px-3 py-2 tabular-nums">{order.qty > 0 ? order.qty : '—'}</td>
                    <td className="px-3 py-2 uppercase">{order.environment}</td>
                    <td className="px-3 py-2">
                      <span
                        className={
                          order.status === 'filled' || order.status === 'submitted'
                            ? 'text-signal-buy'
                            : order.status === 'failed'
                              ? 'text-signal-sell'
                              : 'text-fg-dim'
                        }
                      >
                        {order.status}
                      </span>
                      {order.errorMessage ? (
                        <span className="block text-[10px] text-fg-dim mt-0.5 max-w-xs truncate">
                          {order.errorMessage}
                        </span>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
