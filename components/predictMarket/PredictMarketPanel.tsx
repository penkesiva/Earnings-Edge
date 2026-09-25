import Link from 'next/link';
import { formatDayHeader } from '@/lib/earningsDate';
import type { PredictMarketPageData } from '@/lib/predictMarket/loadPredictMarketPageData';
import { predictMarketScheduleHint } from '@/lib/predictMarket/loadPredictMarketPageData';
import {
  directionTextCls,
  displayRangeFromPrediction,
} from '@/lib/predictMarket/enrichForecastRange';
import { PM_TIMELINE_STEPS } from '@/lib/predictMarket/sessionUiLabels';
import { PredictMarketAccuracyCalendar } from '@/components/predictMarket/PredictMarketAccuracyCalendar';
import type { PredictMarketCalendarMonth } from '@/lib/predictMarket/loadSessionCalendarMonth';

export type PredictMarketPanelData = PredictMarketPageData & {
  calendar: PredictMarketCalendarMonth;
};

function displayDirection(row: Record<string, unknown> | null | undefined): string {
  return (row?.direction as string) ?? '—';
}

function fmtPct(n: number | null | undefined) {
  if (n == null || Number.isNaN(n)) return '—';
  return `${n.toFixed(0)}%`;
}

export function PredictMarketPanel({ data }: { data: PredictMarketPanelData }) {
  const nextLabel = formatDayHeader(data.nextSessionDate);
  const featured = data.featured;
  const featuredLabel = featured ? formatDayHeader(featured.sessionDate) : null;
  const night = featured?.night;
  const pre = featured?.premarket;
  const primary = (pre ?? night) as Record<string, unknown> | null | undefined;
  const direction = displayDirection(primary);

  const cardTitle = !featured
    ? 'No sessions yet'
    : data.featuredIsUpcoming
      ? 'Upcoming session forecast'
      : featured.hasOutcome
        ? 'Last session (graded)'
        : 'Session in progress';

  const cardDateLine =
    featured && featured.sessionDate !== data.nextSessionDate
      ? `${featuredLabel} · next trading day is ${nextLabel}`
      : nextLabel;

  return (
    <div className="space-y-8 max-w-3xl">
      {data.migrationRequired ? (
        <div className="border border-signal-watch/40 bg-signal-watch/5 px-4 py-3 text-sm text-fg-subtle">
          Run <code className="font-mono text-xs">0022_predict_market.sql</code> in Supabase to
          enable PredictMarket storage.
        </div>
      ) : null}

      <section className="border border-border">
        <div className="px-4 py-5 border-b border-border-subtle space-y-2">
          <p className="text-[10px] tracking-widest text-fg-dim uppercase">PredictMarket</p>
          <h2 className="text-lg font-bold">{cardTitle}</h2>
          <p className="text-sm text-fg-subtle">{cardDateLine}</p>
          <p className="text-[11px] text-fg-dim leading-relaxed">{predictMarketScheduleHint()}</p>
        </div>
        <div className="px-4 py-5 space-y-3">
          {night || pre ? (
            <>
              <p className="text-[10px] text-fg-dim uppercase tracking-widest">
                Latest forecast
                {pre && night ? ' (premarket overrides display)' : night ? ' (night)' : ' (premarket)'}
              </p>
              <p className="text-2xl font-bold tracking-tight">
                <span className={directionTextCls(direction)}>{direction}</span>{' '}
                <span className="text-fg-subtle text-base font-normal">
                  {fmtPct((pre?.confidence as number) ?? (night?.confidence as number))} confidence
                </span>
              </p>
              <p className="text-xs text-fg-subtle">
                Expected SPX range (SPY×10 proxy):{' '}
                {displayRangeFromPrediction(pre ?? night, featured?.spxAnchor)}
              </p>
              <p className="text-xs text-fg-subtle">
                Bias: {(pre?.trade_bias as string) ?? (night?.trade_bias as string) ?? '—'}
              </p>
              {night && pre ? (
                <p className="text-[11px] text-fg-dim">
                  Night was {String(night.direction)} {fmtPct(night.confidence as number)} → premarket{' '}
                  {String(pre.direction)} {fmtPct(pre.confidence as number)}.
                </p>
              ) : null}
            </>
          ) : (
            <p className="text-sm text-fg-subtle">
              No forecasts stored for the highlighted session yet. Cron runs on the schedule below
              (Pacific). Manual test:{' '}
              <code className="font-mono text-[10px]">
                /api/cron/predict-market?phase=night&amp;force=1
              </code>
            </p>
          )}
          {featured ? (
            <Link
              href={`/predictmarket/sessions/${featured.sessionDate}`}
              className="text-xs text-accent hover:underline inline-block"
            >
              View full timeline for {featuredLabel} →
            </Link>
          ) : null}
        </div>
      </section>

      {!data.migrationRequired ? <PredictMarketAccuracyCalendar calendar={data.calendar} /> : null}

      <section className="border border-border divide-y divide-border-subtle">
        <div className="px-4 py-3 space-y-1">
          <h3 className="text-sm font-bold tracking-wide">
            <span className="page-chevron">›</span> Daily schedule
          </h3>
          <p className="text-[11px] text-fg-dim">
            Each step writes immutable rows. LLM steps = NIGHT + PREMARKET only; the rest are rules +
            market data.
          </p>
        </div>
        {PM_TIMELINE_STEPS.map(row => (
          <div key={row.key} className="px-4 py-3 flex justify-between gap-4 text-xs">
            <span className="font-bold tracking-wide">{row.label}</span>
            <span className="text-fg-dim tabular-nums text-right">{row.timePt}</span>
          </div>
        ))}
      </section>

      <section className="border border-border">
        <div className="px-4 py-3 border-b border-border-subtle">
          <h3 className="text-sm font-bold tracking-wide">
            <span className="page-chevron">›</span> PredictMarket performance
          </h3>
        </div>
        <div className="px-4 py-4 grid grid-cols-2 sm:grid-cols-3 gap-4 text-xs">
          <Stat label="Direction accuracy" value={fmtPct(data.performance.directionAccuracy)} />
          <Stat label="Night accuracy" value={fmtPct(data.performance.nightDirectionAccuracy)} />
          <Stat
            label="Premarket accuracy"
            value={fmtPct(data.performance.premarketDirectionAccuracy)}
          />
          <Stat label="Range coverage" value={fmtPct(data.performance.rangeCoveragePct)} />
          <Stat label="Scored sessions" value={String(data.performance.sampleSize)} />
        </div>
        <p className="px-4 pb-4 text-[10px] text-fg-dim">
          All metrics are computed in code from stored outcomes — not LLM estimates.
        </p>
      </section>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-fg-dim uppercase tracking-widest text-[10px]">{label}</p>
      <p className="text-lg font-bold tabular-nums mt-1">{value}</p>
    </div>
  );
}
