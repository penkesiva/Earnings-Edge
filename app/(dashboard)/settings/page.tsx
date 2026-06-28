import { requireAuthSession } from '@/lib/authServer';
import { listAlpacaAccountSummaries } from '@/lib/alpacaCredentials';
import { AlpacaAccountsPanel } from '@/components/settings/AlpacaAccountsPanel';

export const dynamic = 'force-dynamic';

export default async function SettingsPage() {
  const { user } = await requireAuthSession();
  const alpacaSummaries = await listAlpacaAccountSummaries(user.id);

  return (
    <div className="space-y-8 max-w-xl">
      <div>
        <h1 className="text-2xl sm:text-3xl font-bold tracking-tight mb-2">
          <span className="page-chevron">›</span> SETTINGS
        </h1>
        <p className="text-sm text-fg-subtle">Your account, Alpaca keys, and preferences</p>
      </div>

      <section className="border panel-accent divide-y divide-border-subtle">
        <div className="px-4 py-3 bg-bg-elevated text-xs text-fg-subtle uppercase tracking-widest">
          Account
        </div>
        <div className="px-4 py-4 space-y-1">
          <p className="text-xs text-fg-dim uppercase tracking-widest">Signed in as</p>
          <p className="text-sm text-fg break-all">{user.email ?? user.id}</p>
        </div>
      </section>

      <section className="space-y-3">
        <div>
          <h2 className="text-sm font-bold tracking-widest uppercase text-fg-subtle">
            Alpaca accounts
          </h2>
          <p className="text-xs text-fg-dim mt-1">
            Paper and live keys are stored separately per user — never shared.
          </p>
        </div>
        <AlpacaAccountsPanel summaries={alpacaSummaries} />
      </section>

      <section className="border border-border divide-y divide-border-subtle">
        <div className="px-4 py-3 bg-bg-elevated text-xs text-fg-subtle uppercase tracking-widest">
          Privacy
        </div>
        <div className="px-4 py-4 space-y-2 text-sm text-fg-subtle">
          <p>Your watchlist, briefs, and scan history are private to this Google account.</p>
          <p>FMP and shared server keys still power earnings calendar data until you add your own Alpaca keys above.</p>
        </div>
      </section>
    </div>
  );
}
