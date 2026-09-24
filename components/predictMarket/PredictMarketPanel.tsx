import Link from 'next/link';
import { formatDayHeader } from '@/lib/earningsDate';
import type { PredictMarketPageData } from '@/lib/predictMarket/loadPredictMarketPageData';
import {
  directionTextCls,
  displayRangeFromPrediction,
} from '@/lib/predictMarket/enrichForecastRange';

const TIMELINE = [
  { label: 'NIGHT FORECAST', time: '9:00 PM PT' },
  { label: 'PREMARKET FORECAST', time: '6:10 AM PT' },
  { label: 'OPEN', time: '6:30 AM PT' },
  { label: 'ENTRY WINDOW', time: '6:31–7:00 AM PT' },
  { label: 'FIRST CHECK', time: '7:00 AM PT' },
  { label: 'MIDDAY CHECK', time: '10:00 AM PT' },
  { label: 'FINAL GRADE', time: '1:15 PM PT' },
] as const;

function fmtPct(n: number | null | undefined) {
  if (n == null || Number.isNaN(n)) return '—';
  return `${n.toFixed(0)}%`;
}

export function PredictMarketPanel({ data }: { data: PredictMarketPageData }) {
  const nextLabel = formatDayHeader(data.nextSessionDate);
  const night = data.latestSession?.night;
  const pre = data.latestSession?.premarket;
  const primary = (pre ?? night) as Record<string, unknown> | null | undefined;
  const direction = displayDirection(primary);

  return (
    <div className="space-y-8 max-w-3xl">
      {data.migrationRequired ? (
        <div className="border border-signal-watch/40 bg-signal-watch/5 px-4 py-3 text-sm text-fg-subtle">
          Run <code className="font-mono text-xs">0022_predict_market.sql</code> in Supabase to
          enable PredictMarket storage.
        </div>
      ) : null}

      <section className="border border-border">
        <div className="px-4 py-5 border-b border-border-subtle">
          <p className="text-[10px] tracking-widest text-fg-dim uppercase">PredictMarket</p>
          <h2 className="text-lg font-bold mt-1">Next session</h2>
          <p className="text-sm text-fg-subtle mt-1">{nextLabel}</p>
        </div>
        <div className="px-4 py-5 space-y-3">
          {night || pre ? (
            <>
              <p className="text-2xl font-bold tracking-tight">
                <span className={directionTextCls(direction)}>{direction}</span>{' '}
                <span className="text-fg-subtle text-base font-normal">
                  {fmtPct((pre?.confidence as number) ?? (night?.confidence as number))} confidence
                </span>
              </p>
              <p className="text-xs text-fg-subtle">
                Expected SPX range (SPY×10 proxy):{' '}
                {displayRangeFromPrediction(pre ?? night, data.latestSession?.spxAnchor)}
              </p>
              <p className="text-xs text-fg-subtle">
                Bias: {(pre?.trade_bias as string) ?? (night?.trade_bias as string) ?? '—'}
              </p>
            </>
          ) : (
            <p className="text-sm text-fg-subtle">
              No forecasts yet for this session. Vercel cron runs on the timeline below (Pacific).
              Night runs ~9:00 PM PT; premarket ~6:10 AM PT. Or trigger manually:{' '}
              <code className="font-mono text-[10px]">
                /api/cron/predict-market?phase=night&amp;force=1
              </code>
            </p>
          )}
          {data.latestSession ? (
            <Link
              href={`/predictmarket/sessions/${data.latestSession.sessionDate}`}
              className="text-xs text-accent hover:underline"
            >
              View session timeline →
            </Link>
          ) : null}
        </div>
      </section>

      <section className="border border-border divide-y divide-border-subtle">
        <div className="px-4 py-3">
          <h3 className="text-sm font-bold tracking-wide">
            <span className="page-chevron">›</span> Daily timeline
          </h3>
        </div>
        {TIMELINE.map(row => (
          <div key={row.label} className="px-4 py-3 flex justify-between gap-4 text-xs">
            <span className="font-bold tracking-wide">{row.label}</span>
            <span className="text-fg-dim tabular-nums">{row.time}</span>
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
