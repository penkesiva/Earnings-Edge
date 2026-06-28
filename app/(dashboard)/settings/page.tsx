import { requireAuthSession } from '@/lib/authServer';

export const dynamic = 'force-dynamic';

export default async function SettingsPage() {
  const { user } = await requireAuthSession();

  return (
    <div className="space-y-8 max-w-xl">
      <div>
        <h1 className="text-2xl sm:text-3xl font-bold tracking-tight mb-2">
          <span className="page-chevron">›</span> SETTINGS
        </h1>
        <p className="text-sm text-fg-subtle">Your account and preferences</p>
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

      <section className="border border-border divide-y divide-border-subtle">
        <div className="px-4 py-3 bg-bg-elevated text-xs text-fg-subtle uppercase tracking-widest">
          Data
        </div>
        <div className="px-4 py-4 space-y-2 text-sm text-fg-subtle">
          <p>Your watchlist, briefs, and scan history are private to this account.</p>
          <p>Market data keys are shared for now. Per-user Alpaca keys are planned next.</p>
        </div>
      </section>
    </div>
  );
}
