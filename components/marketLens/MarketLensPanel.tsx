import { macroEventOn } from '@/lib/marketLens/events';
import { planPaperOrder } from '@/lib/marketLens/paper';
import type { DayReplay } from '@/lib/marketLens/types';

function fmtPt(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-US', {
    timeZone: 'America/Los_Angeles',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function money(n: number): string {
  return n.toFixed(2);
}

export function MarketLensPanel({
  replay,
  error,
}: {
  replay: DayReplay | null;
  error: string | null;
}) {
  const event = replay ? macroEventOn(replay.sessionDate) : null;
  const trade = replay?.trades[0] ?? null;
  const plan = trade ? planPaperOrder(trade) : null;

  return (
    <div className="space-y-8 max-w-3xl">
      <section className="border border-border">
        <div className="px-4 py-5 border-b border-border-subtle space-y-2">
          <p className="text-[10px] tracking-widest text-fg-dim uppercase">MarketLens</p>
          <h2 className="text-lg font-bold">SPY paper setups</h2>
          <p className="text-sm text-fg-subtle">
            Support, resistance, and VWAP on closed 1-minute bars. One attempt per day. Default is no trade.
            Nothing here sends an Alpaca order.
          </p>
        </div>
        <div className="px-4 py-5 space-y-3 text-sm">
          {error ? <p className="text-fg-subtle">{error}</p> : null}
          {replay ? (
            <>
              <p className="text-[10px] text-fg-dim uppercase tracking-widest">
                Last finished session {replay.sessionDate}
                {event ? ` · ${event.name}` : ''}
              </p>
              <p className="text-2xl font-bold tracking-tight">{replay.status}</p>
              <p className="text-xs text-fg-subtle">
                Prior close {money(replay.priorClose)} · high {money(replay.priorHigh)} · low {money(replay.priorLow)}
              </p>
              <p className="text-xs text-fg-subtle">{replay.note}</p>
            </>
          ) : null}
        </div>
      </section>

      {trade && plan ? (
        <section className="border border-border">
          <div className="px-4 py-3 border-b border-border-subtle">
            <h3 className="text-sm font-bold tracking-wide">
              <span className="page-chevron">›</span> Paper signal
            </h3>
          </div>
          <div className="px-4 py-4 space-y-2 text-xs text-fg-subtle">
            <p className="text-sm font-bold text-fg">
              {trade.setup} · {trade.side} · {trade.exitReason} · R {trade.rMultiple.toFixed(2)}
            </p>
            <p>
              Signal {fmtPt(trade.signalTime)} PT · fill {fmtPt(trade.entryTime)} PT · out {fmtPt(trade.exitTime)} PT
            </p>
            <p>
              Entry {money(trade.entry)} · stop {money(trade.stop)} · target {money(trade.target)} · exit {money(trade.exit)}
            </p>
            <p>Probability: INSUFFICIENT_EVIDENCE. Planned reward/risk is 2.0 before this fill is judged.</p>
            {trade.ambiguousBar ? <p>Stop and target were both inside one bar. The stop was used.</p> : null}
            <p className="text-fg-dim">
              Alpaca paper plan (not sent): {plan.side} 1 SPY, stop {plan.stop_price}, target {plan.target_price}.
            </p>
          </div>
        </section>
      ) : null}

      <section className="border border-border">
        <div className="px-4 py-3 border-b border-border-subtle">
          <h3 className="text-sm font-bold tracking-wide">
            <span className="page-chevron">›</span> Backtest
          </h3>
        </div>
        <div className="px-4 py-4 space-y-2 text-xs text-fg-subtle">
          <p>Uses the same Alpaca bars as the rest of the app. Output is R per hypothetical share, after 1 cent of slippage.</p>
          <p className="font-mono text-[11px] text-fg">npm run marketlens</p>
          <p className="font-mono text-[11px] text-fg">npm run marketlens -- 20</p>
          <p className="font-mono text-[11px] text-fg">npm run marketlens -- 2026-10-01 2026-10-16</p>
          <p>Live and paper order routing stays off until a walk-forward test says a setup is worth sending.</p>
        </div>
      </section>
    </div>
  );
}
