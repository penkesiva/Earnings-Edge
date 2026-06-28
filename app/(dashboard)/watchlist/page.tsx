import { requireAuthSession } from '@/lib/authServer';
import { AddTickerForm } from './AddTickerForm';
import { BatchImportForm } from './BatchImportForm';
import { deleteTicker, setManualEarnings, toggleTicker } from './actions';
import { DashboardRefresh } from '@/components/DashboardRefresh';
import { WatchlistMobileList } from './WatchlistMobileList';

export const dynamic = 'force-dynamic';

export default async function WatchlistPage() {
  const { sb } = await requireAuthSession();
  const { data: tickers } = await sb
    .from('watchlist')
    .select('*')
    .order('ticker', { ascending: true });

  return (
    <div className="space-y-5 md:space-y-8">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
        <div className="min-w-0">
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight mb-2">
            <span className="text-fg-subtle">›</span> WATCHLIST
          </h1>
          <p className="text-sm text-fg-subtle">
            {tickers?.filter(t => t.active).length ?? 0} active · {tickers?.length ?? 0} total
          </p>
        </div>
        <div className="w-full sm:max-w-sm shrink-0">
          <DashboardRefresh />
        </div>
      </div>

      <AddTickerForm />
      <BatchImportForm />

      <WatchlistMobileList tickers={tickers ?? []} />

      <div className="hidden md:block border border-border">
        <div className="grid grid-cols-12 gap-4 px-4 py-2 bg-bg-elevated text-xs text-fg-subtle uppercase tracking-widest border-b border-border">
          <div className="col-span-2">TKR</div>
          <div className="col-span-5">MANUAL ER (OPT)</div>
          <div className="col-span-2">STATUS</div>
          <div className="col-span-3 text-right">ACTIONS</div>
        </div>
        {tickers?.map(t => (
          <div key={t.id} className="grid grid-cols-12 gap-4 px-4 py-3 text-sm border-b border-border-subtle items-center">
            <div className="col-span-2 font-bold">{t.ticker}</div>
            <div className="col-span-5">
              <form action={setManualEarnings} className="flex gap-1 items-center">
                <input type="hidden" name="id" value={t.id} />
                <input
                  type="date"
                  name="manual_earnings_date"
                  defaultValue={t.manual_earnings_date ?? ''}
                  key={t.manual_earnings_date ?? 'no-date'}
                  className="w-[138px] bg-bg border border-border px-2 py-1 text-xs focus:outline-none focus:border-signal-buy"
                />
                <select
                  name="manual_timing"
                  defaultValue={t.manual_timing ?? ''}
                  key={t.manual_timing ?? 'no-timing'}
                  className="bg-bg border border-border px-1.5 py-1 text-xs focus:outline-none focus:border-signal-buy"
                >
                  <option value="">--</option>
                  <option value="BMO">BMO</option>
                  <option value="AMC">AMC</option>
                  <option value="UNK">UNK</option>
                </select>
                <button type="submit" className="brief-action-btn brief-action-btn--save">
                  SAVE
                </button>
              </form>
            </div>
            <div className="col-span-2">
              <span className={`text-xs ${t.active ? 'text-signal-buy' : 'text-fg-subtle'}`}>
                {t.active ? '● ACTIVE' : '○ PAUSED'}
              </span>
            </div>
            <div className="col-span-3 text-right flex gap-2 justify-end">
              <form action={toggleTicker}>
                <input type="hidden" name="id" value={t.id} />
                <input type="hidden" name="active" value={t.active.toString()} />
                <button className="text-xs text-fg-subtle hover:text-fg">
                  {t.active ? 'PAUSE' : 'RESUME'}
                </button>
              </form>
              <form action={deleteTicker}>
                <input type="hidden" name="id" value={t.id} />
                <button className="text-xs text-fg-subtle hover:text-signal-sell">
                  DEL
                </button>
              </form>
            </div>
          </div>
        ))}
        {!tickers?.length && (
          <div className="px-4 py-8 text-center text-fg-subtle text-sm">
            No tickers. Add one above.
          </div>
        )}
      </div>
    </div>
  );
}
