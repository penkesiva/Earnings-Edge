'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { useFormState, useFormStatus } from 'react-dom';
import { FinalVerdictBadge } from '@/components/FinalVerdictBadge';
import { DirectionIndicator } from '@/components/DirectionIndicator';
import type { AutomationSettings, TradeOrderRow } from '@/lib/automationSettings';
import type { GoTradeCandidate } from '@/lib/goTradeCandidates';
import {
  closeTradeOrderAction,
  enableLiveTradingAction,
  runAutoTradeNowAction,
  toggleAutoTradeAction,
  toggleKillSwitchAction,
  updateMaxNotionalAction,
  type TradePageState,
} from '@/lib/tradePageActions';

const FIELD =
  'w-full h-10 box-border bg-bg border border-border px-3 text-sm font-mono focus:outline-none focus:border-accent';

/** Compact button base — intentionally NOT built on FIELD (w-full made buttons stretch). */
const BTN =
  'inline-flex items-center justify-center h-9 box-border bg-bg border border-border px-4 text-xs tracking-widest whitespace-nowrap font-mono focus:outline-none disabled:opacity-50';

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
      ? `${BTN} border-signal-sell text-signal-sell hover:bg-signal-sell/10`
      : variant === 'ghost'
        ? `${BTN} text-fg-muted hover:border-fg-subtle`
        : `${BTN} font-bold border-accent text-accent hover:bg-accent-muted`;

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
  const [closeState, closeAction] = useFormState(closeTradeOrderAction, {});
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
            : closeState.error || closeState.success
              ? closeState
              : runState;
  }, [autoState, killState, liveState, notionalState, closeState, runState]);

  const accountMode = settings.liveTradingEnabled ? 'live' : 'paper';
  const goCount = candidates.filter(c => c.verdict === 'GO').length;
  const watchCount = candidates.filter(c => c.verdict === 'WATCH').length;

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
        {/* At a glance */}
        <div className="px-4 py-4 bg-bg-elevated space-y-3">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-sm font-bold tracking-wide">Automation controls</h2>
              <p className="text-xs text-fg-subtle mt-1 max-w-xl">
                Places Alpaca orders from Scan All <strong className="text-fg font-normal">Final verdict</strong>{' '}
                on your active watchlist (GO equity/options, WATCH options). One order per earnings brief.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <StatusPill
                label={settings.autoTradeEnabled ? 'Schedule ON' : 'Schedule OFF'}
                tone={settings.autoTradeEnabled ? 'ok' : 'off'}
              />
              <StatusPill
                label={settings.killSwitch ? 'Kill ON' : 'Kill OFF'}
                tone={settings.killSwitch ? 'danger' : 'off'}
              />
              <StatusPill
                label={accountMode === 'paper' ? 'Paper' : 'Live'}
                tone={accountMode === 'paper' ? 'warn' : 'danger'}
              />
            </div>
          </div>
          <div className="text-[11px] text-fg-dim border border-border-subtle bg-bg px-3 py-2 space-y-1">
            <p>
              <span className="text-fg-subtle font-bold tracking-wide">Schedule ON</span> — weekday cron
              ~3pm ET places trades for today AMC + tomorrow BMO (before the close).
            </p>
            <p>
              <span className="text-fg-subtle font-bold tracking-wide">Run now</span> — same rules, once,
              immediately (works even if Schedule is OFF; still blocked if Kill is ON).
            </p>
            <p>
              <span className="text-fg-subtle font-bold tracking-wide">Kill ON</span> — blocks all new orders
              (cron and Run now) until you release it.
            </p>
          </div>
        </div>

        <div className="px-4 py-4 grid sm:grid-cols-2 gap-6">
          <form action={autoAction} className="space-y-2 border border-border-subtle px-3 py-3">
            <p className="text-xs font-bold tracking-wide">Scheduled auto-trade</p>
            <p className="text-[11px] text-fg-dim leading-relaxed">
              Let the weekday cron submit orders before the close. Default is off until you turn it on.
            </p>
            <input type="hidden" name="enabled" value={String(!settings.autoTradeEnabled)} />
            <ActionButton
              label={settings.autoTradeEnabled ? 'Turn schedule OFF' : 'Turn schedule ON (paper)'}
              pendingLabel="Saving…"
              variant={settings.autoTradeEnabled ? 'ghost' : 'primary'}
            />
          </form>

          <form action={killAction} className="space-y-2 border border-border-subtle px-3 py-3">
            <p className="text-xs font-bold tracking-wide">Emergency kill switch</p>
            <p className="text-[11px] text-fg-dim leading-relaxed">
              Use if something looks wrong. Stops new orders; does not close open positions.
            </p>
            <input type="hidden" name="on" value={String(!settings.killSwitch)} />
            <ActionButton
              label={settings.killSwitch ? 'Release kill switch' : 'Activate kill switch'}
              pendingLabel="Saving…"
              variant={settings.killSwitch ? 'primary' : 'danger'}
            />
          </form>
        </div>

        <div className="px-4 py-4 border-t border-border-subtle">
          <form action={notionalAction} className="flex flex-col sm:flex-row gap-3 sm:items-end">
            <div className="space-y-1.5 flex-1">
              <label
                htmlFor="max_notional_usd"
                className="block text-xs font-bold tracking-wide"
              >
                Max size per trade (USD)
              </label>
              <p className="text-[11px] text-fg-dim">
                Cap for each order — stock notional or option premium budget (contracts sized from this).
              </p>
              <input
                id="max_notional_usd"
                name="max_notional_usd"
                type="number"
                min={100}
                max={100000}
                step={100}
                defaultValue={settings.maxNotionalUsd}
                className={`${FIELD} sm:w-44 tabular-nums mt-1`}
              />
            </div>
            <ActionButton label="Save size" pendingLabel="Saving…" />
          </form>
        </div>

        <div className="px-4 py-4 border-t border-border-subtle space-y-3 border-l-2 border-l-signal-watch/50">
          <div>
            <p className="text-xs font-bold tracking-wide">Real-money trading (optional)</p>
            <p className="text-[11px] text-fg-dim mt-1">
              While off, only your Paper Alpaca keys in Settings are used. Live requires a separate opt-in
              below.
            </p>
          </div>
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
                  className={`${BTN} text-fg-muted`}
                >
                  Cancel
                </button>
              </div>
            </form>
          ) : (
            <button
              type="button"
              onClick={() => setShowLiveConfirm(true)}
              className={`${BTN} text-fg-muted hover:border-fg-subtle`}
            >
              Enable live trading…
            </button>
          )}
        </div>

        <div className="px-4 py-4 border-t border-border-subtle bg-bg-elevated/50">
          <div className="flex flex-col sm:flex-row sm:items-start gap-4 justify-between">
            <div className="space-y-2">
              <h3 className="text-sm font-bold tracking-wide">
                Ready to trade now
                {candidates.length > 0 ? (
                  <span className="text-fg-subtle font-normal">
                    {' '}
                    — {candidates.length} in queue ({goCount} GO · {watchCount} WATCH)
                  </span>
                ) : null}
              </h3>
              <p className="text-xs text-fg-subtle max-w-lg">
                Queue = watchlist names with Final verdict GO or WATCH (UP/DOWN), earnings window
                (today AMC or next-day BMO), not already traded. See list below.
              </p>
            </div>
            <form action={runAction} className="shrink-0">
              <ActionButton
                label="Run now"
                pendingLabel="Placing orders…"
                variant="primary"
              />
            </form>
          </div>
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-bold tracking-wide">
          <span className="page-chevron">›</span> TRADE QUEUE
        </h2>
        <p className="text-[11px] text-fg-dim -mt-1">
          These names would be sent on the next Run now or scheduled cron (if Schedule ON and Kill OFF).
        </p>
        {candidates.length === 0 ? (
          <p className="text-xs text-fg-subtle border border-border px-4 py-6 text-center">
            No eligible trades. Run Scan All until Final verdict is GO or WATCH with UP/DOWN (options legs).
          </p>
        ) : (
          <ul className="border border-border divide-y divide-border-subtle">
            {candidates.map(row => (
              <li key={row.briefId} className="px-4 py-3 flex items-center gap-3">
                <DirectionIndicator direction={row.direction} />
                <Link href={`/briefs/${row.briefId}`} className="font-bold text-sm hover:text-accent">
                  {row.ticker}
                </Link>
                <FinalVerdictBadge verdict={row.verdict} direction={row.direction} />
                {row.legSummary ? (
                  <span className="text-[10px] text-fg-dim truncate max-w-[140px]" title={row.legSummary}>
                    {row.executionMode === 'equity' ? 'equity' : row.legSummary}
                  </span>
                ) : null}
                <span className="text-[10px] font-bold tracking-widest text-fg-dim border border-border-subtle px-1 py-0.5">
                  {row.earningsDate} {row.timing}
                </span>
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
                  <th className="px-3 py-2 font-medium text-right">P&amp;L</th>
                  <th className="px-3 py-2 font-medium"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border-subtle">
                {orders.map(order => {
                  const isOpen =
                    (order.status === 'submitted' || order.status === 'filled') && !order.closedAt;
                  return (
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
                                : order.status === 'closed'
                                  ? 'text-fg'
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
                      <td className="px-3 py-2 text-right tabular-nums whitespace-nowrap">
                        {order.realizedPnlUsd != null ? (
                          <span
                            className={
                              order.realizedPnlUsd >= 0 ? 'text-signal-buy' : 'text-signal-sell'
                            }
                          >
                            {order.realizedPnlUsd >= 0 ? '+' : ''}${order.realizedPnlUsd.toFixed(2)}
                          </span>
                        ) : (
                          <span className="text-fg-dim">—</span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-right">
                        {isOpen ? (
                          <form action={closeAction}>
                            <input type="hidden" name="order_id" value={order.id} />
                            <button
                              type="submit"
                              className="text-[10px] tracking-widest uppercase px-2 py-1 border border-border text-fg-muted hover:border-signal-sell hover:text-signal-sell"
                            >
                              Close
                            </button>
                          </form>
                        ) : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
