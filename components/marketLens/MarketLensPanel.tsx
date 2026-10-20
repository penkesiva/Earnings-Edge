import { MarketLensDayChart } from '@/components/marketLens/MarketLensDayChart';
import { macroEventOn } from '@/lib/marketLens/events';
import { planPaperOrder } from '@/lib/marketLens/paper';
import type { CandlePoint } from '@/lib/marketLens/replay';
import type { BacktestSummary, DayReplay } from '@/lib/marketLens/types';

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
  summary,
  days,
  runDays,
  chartCandles,
  chartDate,
}: {
  replay: DayReplay | null;
  error: string | null;
  summary: BacktestSummary | null;
  days: DayReplay[];
  runDays: number | null;
  chartCandles: CandlePoint[];
  chartDate: string | null;
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
              {trade.side === 'long' ? 'Bought' : 'Short'} {money(trade.entry)} · {trade.side === 'long' ? 'Sold' : 'Covered'} {money(trade.exit)} · {trade.exitReason} · {trade.rMultiple >= 0 ? '+' : ''}{trade.rMultiple.toFixed(2)} R
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

      {chartDate && chartCandles.length > 0 && !summary ? (
        <section className="border border-border px-4 py-4">
          <MarketLensDayChart
            sessionDate={chartDate}
            candles={chartCandles}
            trade={replay?.trades[0] ?? null}
          />
        </section>
      ) : null}

      <section className="border border-border">
        <div className="px-4 py-3 border-b border-border-subtle">
          <h3 className="text-sm font-bold tracking-wide">
            <span className="page-chevron">›</span> Backtest
          </h3>
        </div>
        <div className="px-4 py-4 space-y-3 text-xs text-fg-subtle">
          <p>Runs in the browser against Alpaca. 20 finished sessions is the cap on this page. Longer ranges stay on the command line.</p>
          <form method="get" className="flex flex-wrap items-center gap-2">
            <select
              name="days"
              defaultValue={String(runDays ?? 10)}
              className="h-9 border border-border bg-transparent px-2 text-xs text-fg"
            >
              <option value="5">5 sessions</option>
              <option value="10">10 sessions</option>
              <option value="20">20 sessions</option>
            </select>
            <button
              type="submit"
              className="inline-flex h-9 items-center justify-center border border-border px-4 text-xs font-bold tracking-wide text-fg-subtle hover:border-accent hover:text-accent"
            >
              Run backtest
            </button>
          </form>
          {summary ? (
            <div className="space-y-2">
              <p className="text-sm font-bold text-fg">
                {summary.sessions} sessions · {summary.trades} trades · {summary.wins} wins · {summary.losses} losses · total R {summary.totalR.toFixed(2)}
              </p>
              <p>Probability is INSUFFICIENT_EVIDENCE. A negative total R means the rules lost on this sample.</p>
              {chartDate && chartCandles.length > 0 ? (
                <MarketLensDayChart
                  sessionDate={chartDate}
                  candles={chartCandles}
                  trade={days.find(d => d.sessionDate === chartDate)?.trades[0] ?? null}
                />
              ) : null}
              <div className="divide-y divide-border-subtle border border-border">
                {days.flatMap(day =>
                  day.trades.length
                    ? day.trades.map(t => {
                        const bought = t.side === 'long';
                        const href = `/marketlens?days=${runDays ?? 10}&chart=${day.sessionDate}`;
                        return (
                          <a
                            key={`${day.sessionDate}-${t.signalTime}`}
                            href={href}
                            className={`block px-3 py-2 hover:bg-accent-muted ${chartDate === day.sessionDate ? 'bg-accent-muted' : ''}`}
                          >
                            <span className="text-fg">
                              {day.sessionDate} · {bought ? 'Bought' : 'Short'} {money(t.entry)} at {fmtPt(t.entryTime)} PT
                              {' · '}
                              {bought ? 'Sold' : 'Covered'} {money(t.exit)} at {fmtPt(t.exitTime)} PT
                            </span>
                            <span className="text-fg-dim">
                              {' '}
                              · {t.exitReason} · {t.rMultiple >= 0 ? '+' : ''}
                              {t.rMultiple.toFixed(2)} R
                            </span>
                          </a>
                        );
                      })
                    : [
                        <div key={day.sessionDate} className="px-3 py-2 text-fg-dim">
                          {day.sessionDate} · no trade
                        </div>,
                      ],
                )}
              </div>
            </div>
          ) : null}
        </div>
      </section>
    </div>
  );
}
