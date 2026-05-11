import { supabaseAdmin } from '@/lib/supabase';
import { AddTickerForm } from './AddTickerForm';
import { BatchImportForm } from './BatchImportForm';
import { deleteTicker, setManualEarnings, toggleTicker } from './actions';
import { DashboardRefresh } from '@/components/DashboardRefresh';

export const dynamic = 'force-dynamic';

export default async function WatchlistPage() {
  const sb = supabaseAdmin();
  const { data: tickers } = await sb
    .from('watchlist')
    .select('*')
    .order('ticker', { ascending: true });

  return (
    <div className="space-y-8">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight mb-2">
            <span className="text-fg-subtle">›</span> WATCHLIST
          </h1>
          <p className="text-sm text-fg-subtle">
            {tickers?.filter(t => t.active).length ?? 0} active · {tickers?.length ?? 0} total
          </p>
        </div>
        <DashboardRefresh />
      </div>

      <AddTickerForm />
      <BatchImportForm />

      <div className="md:hidden space-y-2">
        {tickers?.map(t => (
          <div key={t.id} className="border border-border bg-bg-elevated p-3">
            <div className="flex items-center justify-between">
              <div className="font-bold text-lg">{t.ticker}</div>
              <span className={`text-xs ${t.active ? 'text-signal-buy' : 'text-fg-subtle'}`}>
                {t.active ? '● ACTIVE' : '○ PAUSED'}
              </span>
            </div>
            <div className="text-fg-muted text-xs mt-1">{t.thesis || '—'}</div>
            <form action={setManualEarnings} className="flex gap-1 items-center mt-3">
              <input type="hidden" name="id" value={t.id} />
              <input
                type="date"
                name="manual_earnings_date"
                defaultValue={t.manual_earnings_date ?? ''}
                key={t.manual_earnings_date ?? 'no-date'}
                className="flex-1 bg-bg border border-border px-2 py-1 text-xs focus:outline-none focus:border-signal-buy"
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
              <button className="text-[10px] text-fg-subtle hover:text-fg tracking-widest">
                SAVE
              </button>
            </form>
            <div className="mt-3 flex gap-3 text-xs">
              <form action={toggleTicker}>
                <input type="hidden" name="id" value={t.id} />
                <input type="hidden" name="active" value={t.active.toString()} />
                <button className="text-fg-subtle hover:text-fg">
                  {t.active ? 'PAUSE' : 'RESUME'}
                </button>
              </form>
              <form action={deleteTicker}>
                <input type="hidden" name="id" value={t.id} />
                <button className="text-fg-subtle hover:text-signal-sell">
                  DEL
                </button>
              </form>
            </div>
          </div>
        ))}
        {!tickers?.length && (
          <div className="px-4 py-8 text-center text-fg-subtle text-sm border border-border bg-bg-elevated">
            No tickers. Add one above.
          </div>
        )}
      </div>

      <div className="hidden md:block border border-border">
        <div className="grid grid-cols-12 gap-4 px-4 py-2 bg-bg-elevated text-xs text-fg-subtle uppercase tracking-widest border-b border-border">
          <div className="col-span-1">TKR</div>
          <div className="col-span-4">THESIS</div>
          <div className="col-span-3">MANUAL ER (OPT)</div>
          <div className="col-span-2">STATUS</div>
          <div className="col-span-2 text-right">ACTIONS</div>
        </div>
        {tickers?.map(t => (
          <div key={t.id} className="grid grid-cols-12 gap-4 px-4 py-3 text-sm border-b border-border-subtle items-center">
            <div className="col-span-1 font-bold">{t.ticker}</div>
            <div className="col-span-4 text-fg-muted text-xs">{t.thesis || '—'}</div>
            <div className="col-span-3">
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
                <button className="text-[10px] text-fg-subtle hover:text-fg tracking-widest">
                  SAVE
                </button>
              </form>
            </div>
            <div className="col-span-2">
              <span className={`text-xs ${t.active ? 'text-signal-buy' : 'text-fg-subtle'}`}>
                {t.active ? '● ACTIVE' : '○ PAUSED'}
              </span>
            </div>
            <div className="col-span-2 text-right flex gap-2 justify-end">
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
