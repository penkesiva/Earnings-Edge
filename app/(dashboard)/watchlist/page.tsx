import { supabaseAdmin } from '@/lib/supabase';
import { AddTickerForm } from './AddTickerForm';
import { deleteTicker, toggleTicker } from './actions';

export const dynamic = 'force-dynamic';

export default async function WatchlistPage() {
  const sb = supabaseAdmin();
  const { data: tickers } = await sb
    .from('watchlist')
    .select('*')
    .order('ticker', { ascending: true });

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold tracking-tight mb-2">
          <span className="text-fg-subtle">›</span> WATCHLIST
        </h1>
        <p className="text-sm text-fg-subtle">
          {tickers?.filter(t => t.active).length ?? 0} active · {tickers?.length ?? 0} total
        </p>
      </div>

      <AddTickerForm />

      <div className="border border-border">
        <div className="grid grid-cols-12 gap-4 px-4 py-2 bg-bg-elevated text-xs text-fg-subtle uppercase tracking-widest border-b border-border">
          <div className="col-span-1">TKR</div>
          <div className="col-span-7">THESIS</div>
          <div className="col-span-2">STATUS</div>
          <div className="col-span-2 text-right">ACTIONS</div>
        </div>
        {tickers?.map(t => (
          <div key={t.id} className="grid grid-cols-12 gap-4 px-4 py-3 text-sm border-b border-border-subtle items-center">
            <div className="col-span-1 font-bold">{t.ticker}</div>
            <div className="col-span-7 text-fg-muted text-xs">{t.thesis || '—'}</div>
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
