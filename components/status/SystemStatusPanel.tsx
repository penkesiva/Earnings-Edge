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

function cardBorder(status: HealthStatus): string {
  if (status === 'ok') return 'border-signal-buy/25';
  if (status === 'warn') return 'border-signal-watch/35';
  if (status === 'fail') return 'border-signal-sell/35';
  return 'border-border';
}

function StatusCard({
  status,
  title,
  detail,
  href,
  footer,
}: {
  status: HealthStatus;
  title: string;
  detail?: string;
  href?: string;
  footer?: string;
}) {
  const body = (
    <>
      <div className="flex items-start justify-between gap-2">
        <StatusDot status={status} />
        <StatusBadge status={status} />
      </div>
      <div className="flex-1 min-w-0">
        <p className={`text-sm font-medium leading-snug ${href ? 'group-hover:text-accent' : ''}`}>
          {title}
        </p>
        {detail ? (
          <p className="text-xs text-fg-dim mt-2 break-words leading-relaxed">{detail}</p>
        ) : null}
        {footer ? (
          <p className="text-[10px] text-fg-dim mt-2 uppercase tracking-widest">{footer}</p>
        ) : null}
      </div>
    </>
  );

  const cls = `border bg-bg-elevated p-4 flex flex-col gap-3 h-full min-h-[7rem] transition-colors ${cardBorder(status)}`;

  if (href) {
    return (
      <Link href={href} className={`${cls} group hover:bg-bg-hover hover:border-accent/40`}>
        {body}
      </Link>
    );
  }

  return <article className={cls}>{body}</article>;
}

export function SystemStatusPanel({ report }: { report: SystemHealthReport }) {
  const allOk = report.summary.fail === 0;
  const shipped = SYSTEM_STATUS_MANIFEST.phases.filter(p => p.status === 'shipped');

  return (
    <div className="space-y-8 max-w-4xl">
      <section
        className={`border px-5 py-5 sm:px-6 ${
          allOk ? 'panel-accent border-signal-buy/30 bg-signal-buy/5' : 'border-signal-watch/40 bg-signal-watch/5'
        }`}
      >
        <div className="flex items-start gap-3">
          <StatusDot status={allOk ? 'ok' : 'warn'} />
          <div className="space-y-2 min-w-0 flex-1">
            <h2 className="text-lg font-bold tracking-tight">
              {allOk ? 'You’re in — everything checks out' : 'Signed in — some checks need attention'}
            </h2>
            <p className="text-sm text-fg-subtle break-all">{report.userEmail}</p>
            <div className="flex flex-wrap gap-2 pt-1">
              <span className="text-[10px] tracking-widest uppercase px-2 py-1 border border-signal-buy/40 text-signal-buy bg-signal-buy/10">
                {report.summary.ok} ok
              </span>
              <span className="text-[10px] tracking-widest uppercase px-2 py-1 border border-signal-watch/40 text-signal-watch bg-signal-watch/10">
                {report.summary.warn} warn
              </span>
              <span className="text-[10px] tracking-widest uppercase px-2 py-1 border border-signal-sell/40 text-signal-sell bg-signal-sell/10">
                {report.summary.fail} fail
              </span>
            </div>
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
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {report.checks.map(row => (
            <StatusCard
              key={row.id}
              status={row.status}
              title={row.label}
              detail={row.detail}
            />
          ))}
        </div>
      </section>

      <section className="space-y-3">
        <h3 className="text-sm font-bold tracking-wide">
          <span className="page-chevron">›</span> SHIPPED CAPABILITIES
        </h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {shipped.map(phase => (
            <StatusCard
              key={phase.id}
              status="ok"
              title={phase.name}
              href={phase.route}
            />
          ))}
        </div>
      </section>

      <div className="text-[10px] text-fg-dim flex flex-wrap items-center gap-x-3 gap-y-1">
        <span>Manifest {report.manifestVersion}</span>
        <BuildStamp />
      </div>
    </div>
  );
}
