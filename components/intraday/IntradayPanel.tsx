'use client';

import Link from 'next/link';
import { useFormState, useFormStatus } from 'react-dom';
import {
  runIntradayBacktestAction,
  saveIntradaySettingsAction,
  type IntradayPageState,
} from '@/lib/intradayPageActions';
import { BACKTEST_DAY_PRESETS } from '@/lib/intraday/config/defaults';

const FIELD =
  'w-full h-10 box-border bg-bg border border-border px-3 text-sm font-mono focus:outline-none focus:border-accent';

function SubmitBtn({ label, pendingLabel }: { label: string; pendingLabel: string }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="inline-flex h-9 items-center justify-center border border-accent px-4 text-xs font-bold tracking-widest text-accent hover:bg-accent-muted disabled:opacity-50"
    >
      {pending ? pendingLabel : label}
    </button>
  );
}

function Flash({ state }: { state: IntradayPageState }) {
  const text = state.error ?? state.success;
  if (!text) return null;
  return (
    <p
      className={`text-xs px-3 py-2 border ${
        state.error ? 'border-signal-sell/40 text-signal-sell' : 'border-signal-buy/40 text-signal-buy'
      }`}
    >
      {text}
    </p>
  );
}

type RunRow = {
  id: string;
  symbol: string;
  calendar_days: number;
  status: string;
  metrics: Record<string, unknown> | null;
  started_at: string;
  trades?: unknown;
};

export function IntradayPanel({
  migrationRequired,
  strategies,
  settings,
  runs,
  liveTradingEnabled,
  paperConfigured,
}: {
  migrationRequired: boolean;
  strategies: readonly { id: string; label: string; description: string }[];
  settings: Record<string, unknown> | null;
  runs: RunRow[];
  liveTradingEnabled: boolean;
  paperConfigured: boolean;
}) {
  const [saveState, saveAction] = useFormState(saveIntradaySettingsAction, {});
  const [btState, btAction] = useFormState(runIntradayBacktestAction, {});

  const symbol = (settings?.symbol as string) ?? '';
  const companyName = (settings?.company_name as string) ?? '';
  const strategyId = (settings?.strategy_id as string) ?? strategies[0]?.id ?? '';
  const budget = settings?.trading_budget_usd != null ? Number(settings.trading_budget_usd) : 5000;
  const deployPct = settings?.deploy_pct != null ? Number(settings.deploy_pct) : 100;
  const automationOn = Boolean(settings?.automation_enabled);

  const accountMode = liveTradingEnabled ? 'Live' : 'Paper';

  if (migrationRequired) {
    return (
      <div className="border border-signal-watch/40 bg-signal-watch/5 px-4 py-3 text-sm">
        Run <code className="text-xs">0026_intraday_strategy.sql</code> in Supabase. See{' '}
        <Link href="/status" className="text-accent underline">
          Status
        </Link>
        .
      </div>
    );
  }

  return (
    <div className="space-y-8 max-w-3xl">
      {!paperConfigured ? (
        <p className="text-sm text-signal-watch border border-signal-watch/30 px-3 py-2">
          Add Alpaca keys in <Link href="/settings" className="text-accent underline">Settings</Link>{' '}
          to validate tickers and run backtests.
        </p>
      ) : null}

      <section className="border border-border">
        <div className="px-4 py-3 border-b border-border-subtle">
          <h2 className="text-sm font-bold tracking-wide">Strategy & symbol</h2>
          <p className="text-xs text-fg-dim mt-1">One active symbol. US common stocks only.</p>
        </div>
        <form action={saveAction} className="px-4 py-4 space-y-4">
          <Flash state={saveState} />
          <div className="grid sm:grid-cols-2 gap-4">
            <div className="space-y-1">
              <label htmlFor="symbol" className="text-xs font-bold tracking-wide">
                Ticker
              </label>
              <input id="symbol" name="symbol" defaultValue={symbol} className={FIELD} placeholder="RKLB" required />
            </div>
            <div className="space-y-1">
              <label htmlFor="strategy_id" className="text-xs font-bold tracking-wide">
                Strategy
              </label>
              <select id="strategy_id" name="strategy_id" defaultValue={strategyId} className={FIELD}>
                {strategies.map(s => (
                  <option key={s.id} value={s.id}>
                    {s.label}
                  </option>
                ))}
              </select>
            </div>
          </div>
          {companyName ? (
            <p className="text-xs text-fg-subtle">Saved: {companyName}</p>
          ) : null}
          <p className="text-[11px] text-fg-dim">{strategies.find(s => s.id === strategyId)?.description}</p>

          <div className="grid sm:grid-cols-2 gap-4">
            <div className="space-y-1">
              <label htmlFor="trading_budget_usd" className="text-xs font-bold tracking-wide">
                Trading budget (USD)
              </label>
              <input
                id="trading_budget_usd"
                name="trading_budget_usd"
                type="number"
                min={100}
                step={100}
                defaultValue={budget}
                className={`${FIELD} tabular-nums`}
                required
              />
            </div>
            <div className="space-y-1">
              <label htmlFor="deploy_pct" className="text-xs font-bold tracking-wide">
                Deploy % of budget
              </label>
              <input
                id="deploy_pct"
                name="deploy_pct"
                type="number"
                min={1}
                max={100}
                step={1}
                defaultValue={deployPct}
                className={`${FIELD} tabular-nums`}
              />
              <p className="text-[10px] text-fg-dim">Default 100% — max capital used per session.</p>
            </div>
          </div>

          <div className="border border-border-subtle px-3 py-3 space-y-2">
            <p className="text-xs font-bold tracking-wide">Execution mode</p>
            <p className="text-xs text-fg-subtle">
              Orders use <strong>{accountMode}</strong> Alpaca (same as{' '}
              <Link href="/trade" className="text-accent underline">
                Trade
              </Link>
              ). Change live opt-in on Trade page only.
            </p>
            <label className="flex items-center gap-2 text-xs cursor-pointer">
              <input type="checkbox" name="automation_enabled" defaultChecked={automationOn} />
              Enable intraday automation (1-min RTH cron when saved)
            </label>
          </div>

          <SubmitBtn label="Save settings" pendingLabel="Saving…" />
        </form>
      </section>

      <section className="border border-border">
        <div className="px-4 py-3 border-b border-border-subtle">
          <h2 className="text-sm font-bold tracking-wide">Backtest baseline</h2>
          <p className="text-xs text-fg-dim mt-1">Alpaca 1-min bars · same strategy logic as paper.</p>
        </div>
        <form action={btAction} className="px-4 py-4 space-y-4">
          <Flash state={btState} />
          <div className="grid sm:grid-cols-2 gap-4">
            <div className="space-y-1">
              <label className="text-xs font-bold tracking-wide">Ticker</label>
              <input name="symbol" defaultValue={symbol} className={FIELD} required />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-bold tracking-wide">Strategy</label>
              <select name="strategy_id" defaultValue={strategyId} className={FIELD}>
                {strategies.map(s => (
                  <option key={s.id} value={s.id}>
                    {s.label}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="grid sm:grid-cols-2 gap-4">
            <div className="space-y-1">
              <label className="text-xs font-bold tracking-wide">Budget USD</label>
              <input
                name="trading_budget_usd"
                type="number"
                min={100}
                defaultValue={budget}
                className={FIELD}
                required
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-bold tracking-wide">Deploy %</label>
              <input
                name="deploy_pct"
                type="number"
                min={1}
                max={100}
                defaultValue={deployPct}
                className={FIELD}
              />
            </div>
          </div>
          <div className="space-y-1">
            <label htmlFor="calendar_days" className="text-xs font-bold tracking-wide">
              Calendar days (trading sessions)
            </label>
            <input
              id="calendar_days"
              name="calendar_days"
              type="number"
              min={5}
              max={365}
              defaultValue={30}
              className={`${FIELD} sm:w-32 tabular-nums`}
            />
            <div className="flex flex-wrap gap-2 pt-1">
              {BACKTEST_DAY_PRESETS.map(d => (
                <span key={d} className="text-[10px] text-fg-dim">
                  {d}d
                </span>
              ))}
            </div>
          </div>
          <SubmitBtn label="Run backtest" pendingLabel="Running…" />
        </form>
      </section>

      <section className="border border-border divide-y divide-border-subtle">
        <div className="px-4 py-3">
          <h2 className="text-sm font-bold tracking-wide">Backtest history</h2>
        </div>
        {runs.length === 0 ? (
          <p className="px-4 py-6 text-sm text-fg-dim">No runs yet.</p>
        ) : (
          runs.map(run => (
            <BacktestRunDetails key={run.id} run={run} />
          ))
        )}
      </section>
    </div>
  );
}

function BacktestRunDetails({ run }: { run: RunRow }) {
  const m = run.metrics ?? {};
  const trades = (run.trades as Array<Record<string, unknown>>) ?? [];
  return (
    <details className="px-4 py-3 group">
      <summary className="cursor-pointer text-xs font-bold tracking-wide list-none flex justify-between gap-2">
        <span>
          {run.symbol} · {run.calendar_days}d · {run.status}
        </span>
        <span className="text-fg-dim font-normal tabular-nums">
          {new Date(run.started_at).toLocaleDateString()}
        </span>
      </summary>
      <div className="mt-3 space-y-3 text-xs text-fg-subtle">
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          <Metric label="Trades" value={String(m.trades ?? '—')} />
          <Metric label="Win rate" value={fmtPct(m.winRate)} />
          <Metric label="Total P&L" value={fmtUsd(m.totalPnlUsd)} />
          <Metric label="Profit factor" value={fmtNum(m.profitFactor)} />
          <Metric label="Max DD" value={fmtUsd(m.maxDrawdownUsd)} />
          <Metric label="Trades/day" value={fmtNum(m.tradesPerDay)} />
        </div>
        {trades.length > 0 ? (
          <details className="border border-border-subtle">
            <summary className="px-3 py-2 cursor-pointer text-fg-dim">
              Trade log ({trades.length})
            </summary>
            <ul className="max-h-48 overflow-auto divide-y divide-border-subtle border-t border-border-subtle">
              {trades.slice(0, 50).map((t, i) => (
                <li key={i} className="px-3 py-2 font-mono text-[10px]">
                  {String(t.sessionDate)} {String(t.setupType)} {String(t.entryTimeEt)}→
                  {String(t.exitTimeEt)} ${Number(t.pnlUsd).toFixed(2)}
                </li>
              ))}
            </ul>
          </details>
        ) : null}
      </div>
    </details>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[10px] text-fg-dim uppercase tracking-widest">{label}</p>
      <p className="font-bold tabular-nums">{value}</p>
    </div>
  );
}

function fmtPct(v: unknown) {
  return v == null || Number.isNaN(Number(v)) ? '—' : `${Number(v).toFixed(1)}%`;
}
function fmtUsd(v: unknown) {
  return v == null || Number.isNaN(Number(v)) ? '—' : `$${Number(v).toFixed(2)}`;
}
function fmtNum(v: unknown) {
  return v == null || Number.isNaN(Number(v)) ? '—' : Number(v).toFixed(2);
}
