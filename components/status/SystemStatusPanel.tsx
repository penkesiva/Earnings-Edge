import Link from 'next/link';
import { BuildStamp } from '@/components/BuildStamp';
import type { SystemHealthReport, HealthStatus } from '@/lib/systemHealthCheck';
import { SYSTEM_STATUS_MANIFEST } from '@/lib/systemStatusManifest';

function StatusDot({ status }: { status: HealthStatus }) {
  const cls =
    status === 'ok'
      ? 'bg-signal-buy shadow-[0_0_6px_var(--color-signal-buy)]'
      : status === 'warn'
        ? 'bg-signal-watch'
        : status === 'fail'
          ? 'bg-signal-sell'
          : 'bg-fg-dim';

  return <span className={`inline-block w-2 h-2 rounded-full shrink-0 ${cls}`} aria-hidden />;
}

function StatusBadge({ status }: { status: HealthStatus }) {
  const label = status === 'ok' ? 'OK' : status === 'warn' ? 'WARN' : status === 'fail' ? 'FAIL' : 'SKIP';
  const cls =
    status === 'ok'
      ? 'text-signal-buy border-signal-buy/40 bg-signal-buy/10'
      : status === 'warn'
        ? 'text-signal-watch border-signal-watch/40 bg-signal-watch/10'
        : status === 'fail'
          ? 'text-signal-sell border-signal-sell/40 bg-signal-sell/10'
          : 'text-fg-dim border-border-subtle';

  return (
    <span className={`text-[10px] tracking-widest uppercase px-1.5 py-0.5 border ${cls}`}>
      {label}
    </span>
  );
}

export function SystemStatusPanel({ report }: { report: SystemHealthReport }) {
  const allOk = report.summary.fail === 0;
  const shipped = SYSTEM_STATUS_MANIFEST.phases.filter(p => p.status === 'shipped');

  return (
    <div className="space-y-8 max-w-2xl">
      <section
        className={`border px-4 py-5 ${
          allOk ? 'panel-accent border-signal-buy/30 bg-signal-buy/5' : 'border-signal-watch/40 bg-signal-watch/5'
        }`}
      >
        <div className="flex items-start gap-3">
          <StatusDot status={allOk ? 'ok' : 'warn'} />
          <div className="space-y-2 min-w-0">
            <h2 className="text-lg font-bold tracking-tight">
              {allOk ? 'You’re in — everything checks out' : 'Signed in — some checks need attention'}
            </h2>
            <p className="text-sm text-fg-subtle break-all">{report.userEmail}</p>
            <p className="text-xs text-fg-dim">
              {report.summary.ok} ok · {report.summary.warn} warn · {report.summary.fail} fail
            </p>
          </div>
        </div>
        <div className="mt-5 flex flex-wrap gap-2">
          <Link
            href="/"
            className="inline-flex items-center h-9 px-4 text-xs font-bold tracking-widest border border-accent text-accent hover:bg-accent-muted"
          >
            Continue to Home
          </Link>
          <Link
            href="/watchlist"
            className="inline-flex items-center h-9 px-4 text-xs tracking-widest border border-border text-fg-muted hover:border-fg-subtle"
          >
            Watchlist
          </Link>
        </div>
      </section>

      <section className="space-y-3">
        <h3 className="text-sm font-bold tracking-wide">
          <span className="page-chevron">›</span> HEALTH CHECKS
        </h3>
        <ul className="border border-border divide-y divide-border-subtle">
          {report.checks.map(row => (
            <li key={row.id} className="px-4 py-3 flex items-start gap-3">
              <StatusDot status={row.status} />
              <div className="flex-1 min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium">{row.label}</span>
                  <StatusBadge status={row.status} />
                </div>
                {row.detail ? (
                  <p className="text-xs text-fg-dim mt-1 break-words">{row.detail}</p>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      </section>

      <section className="space-y-3">
        <h3 className="text-sm font-bold tracking-wide">
          <span className="page-chevron">›</span> SHIPPED CAPABILITIES
        </h3>
        <ul className="border border-border divide-y divide-border-subtle">
          {shipped.map(phase => (
            <li key={phase.id} className="px-4 py-3 flex items-center gap-3">
              <StatusDot status="ok" />
              <div className="flex-1 min-w-0">
                <Link href={phase.route} className="text-sm font-medium hover:text-accent">
                  {phase.name}
                </Link>
                {phase.migration ? (
                  <p className="text-[10px] text-fg-dim mt-0.5">Migration {phase.migration}</p>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      </section>

      <section className="space-y-3">
        <h3 className="text-sm font-bold tracking-wide">
          <span className="page-chevron">›</span> SUPABASE MIGRATIONS
        </h3>
        <p className="text-xs text-fg-subtle">
          Run in the Supabase SQL editor if health checks show missing tables.
        </p>
        <ul className="border border-border divide-y divide-border-subtle text-xs">
          {SYSTEM_STATUS_MANIFEST.migrations.map(m => (
            <li key={m.id} className="px-4 py-3">
              <p className="font-mono text-fg">{m.file}</p>
              <p className="text-fg-dim mt-1">{m.summary}</p>
            </li>
          ))}
        </ul>
      </section>

      <div className="text-[10px] text-fg-dim flex flex-wrap items-center gap-x-3 gap-y-1">
        <span>Manifest {report.manifestVersion}</span>
        <BuildStamp />
      </div>
    </div>
  );
}
