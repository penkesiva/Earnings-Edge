import type { ReactNode } from 'react';
import {
  directionTextCls,
  displayRangeFromPrediction,
} from '@/lib/predictMarket/enrichForecastRange';
import { summarizeOutcomeMove, formatOutcomeMoveLine } from '@/lib/predictMarket/outcomeGrading';
import {
  computeMorningThesisGrade,
  morningGradeLabel,
  type MorningThesisGrade,
} from '@/lib/predictMarket/morningThesisGrade';
import { formatTargetLabel } from '@/lib/predictMarket/priceTarget/derivePremarketTarget';
import { PM_TIMELINE_STEPS, snapshotKindLabel } from '@/lib/predictMarket/sessionUiLabels';

type PredictionRow = Record<string, unknown>;
type SnapshotRow = { snapshot_kind: string; as_of_pt: string; payload?: unknown };
type SignalRow = { recommended_side: string; reasoning?: string | null };
type CheckpointRow = { checkpoint_kind: string; thesis_status: string; reasoning?: string | null };
type OutcomeRow = {
  actual_direction: string | null;
  daily_return_percent: number | null;
  previous_close?: number | null;
  close?: number | null;
  payload?: { morning_thesis?: MorningThesisGrade } | null;
};

function HitMark({ ok }: { ok: boolean | null | undefined }) {
  if (ok === true) return <span className="text-signal-buy ml-1" aria-label="hit">✓</span>;
  if (ok === false) return <span className="text-signal-sell ml-1" aria-label="miss">✗</span>;
  return null;
}

function fmtTimePt(iso: string | undefined | null): string | null {
  if (!iso) return null;
  try {
    return new Date(iso).toLocaleString('en-US', {
      timeZone: 'America/Los_Angeles',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    });
  } catch {
    return null;
  }
}

function Step({
  title,
  timePt,
  status,
  detail,
  muted,
}: {
  title: string;
  timePt: string;
  status: ReactNode;
  detail?: ReactNode;
  muted?: boolean;
}) {
  return (
    <li className={`px-4 py-4 ${muted ? 'bg-bg-elevated/40' : ''}`}>
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-2">
        <div className="min-w-0">
          <p className="text-xs font-bold tracking-wide">{title}</p>
          <p className="text-[10px] text-fg-dim mt-0.5 tabular-nums">{timePt}</p>
        </div>
        <div className="text-sm font-bold shrink-0 text-right sm:text-left sm:min-w-[12rem]">
          {status}
        </div>
      </div>
      {detail ? <div className="mt-2 text-xs text-fg-subtle leading-relaxed">{detail}</div> : null}
    </li>
  );
}

export function PredictMarketSessionTimeline({
  spxAnchor,
  predictions,
  snapshots,
  signals,
  checkpoints,
  outcome,
  priceTarget,
}: {
  spxAnchor: number | null;
  predictions: PredictionRow[];
  snapshots: SnapshotRow[];
  signals: SignalRow[];
  checkpoints: CheckpointRow[];
  outcome: OutcomeRow | null;
  priceTarget: {
    target_spx: number;
    target_side: 'PUT' | 'CALL';
    target_hit: boolean;
    window_low_spx: number | null;
    window_high_spx: number | null;
  } | null;
}) {
  const night = predictions.find(p => p.prediction_type === 'NIGHT');
  const pre = predictions.find(p => p.prediction_type === 'PREMARKET');
  const openSnap = snapshots.find(s => s.snapshot_kind === 'OPEN');
  const openPayload = openSnap?.payload as { open_thesis?: { summary?: string } } | undefined;
  const signal = signals[0];
  const cp7 = checkpoints.find(c => c.checkpoint_kind === 'FIRST_7AM');
  const cp10 = checkpoints.find(c => c.checkpoint_kind === 'MIDDAY_10AM');

  const morningFromPayload = outcome?.payload?.morning_thesis;
  const morning =
    morningFromPayload ??
    computeMorningThesisGrade({
      premarketDirection: pre ? String(pre.direction) : null,
      tradeBias: pre ? String(pre.trade_bias) : null,
      entrySide: signal ? String(signal.recommended_side) : null,
      checkpoint7Status: cp7 ? String(cp7.thesis_status) : null,
    });

  const entryAligned = morning.entryAligned;
  const cp7Confirmed = morning.checkpoint7Confirmed;

  const premarketPredicted = pre ? String(pre.direction) : null;
  const premarketCorrect = morning.premarketHit;

  const moveSummary =
    outcome?.previous_close != null && outcome?.close != null
      ? summarizeOutcomeMove(Number(outcome.previous_close), Number(outcome.close))
      : null;

  const inputSnaps = snapshots.filter(s =>
    ['NIGHT_INPUT', 'PREMARKET_INPUT', 'OPEN'].includes(s.snapshot_kind),
  );

  return (
    <div className="space-y-4">
      <p className="text-xs text-fg-subtle border border-border-subtle bg-bg px-3 py-2 leading-relaxed">
        Seven scheduled steps per NYSE session (morning thesis grade is primary).{' '}
        <span className="text-fg-dim">
          “Market data saved…” rows are raw inputs fed to the model or rules — not separate predictions.
        </span>
      </p>

      <ul className="border border-border divide-y divide-border-subtle">
        <Step
          title={PM_TIMELINE_STEPS[0].label}
          timePt={PM_TIMELINE_STEPS[0].timePt}
          status={
            night ? (
              <>
                <span className={directionTextCls(String(night.direction))}>{String(night.direction)}</span>
                {' · '}
                {Number(night.confidence)}% · {String(night.trade_bias)}
              </>
            ) : (
              <span className="text-fg-dim font-normal">Pending</span>
            )
          }
          detail={
            night ? (
              <>
                Range: {displayRangeFromPrediction(night, spxAnchor)}
                {night.as_of_pt ? (
                  <span className="text-fg-dim"> · recorded {fmtTimePt(String(night.as_of_pt))} PT</span>
                ) : null}
              </>
            ) : undefined
          }
        />
        <Step
          title={PM_TIMELINE_STEPS[1].label}
          timePt={PM_TIMELINE_STEPS[1].timePt}
          status={
            pre ? (
              <>
                <span className={directionTextCls(String(pre.direction))}>{String(pre.direction)}</span>
                {' · '}
                {Number(pre.confidence)}% · {String(pre.trade_bias)}
              </>
            ) : (
              <span className="text-fg-dim font-normal">Pending</span>
            )
          }
          detail={
            pre ? (
              <>
                Range: {displayRangeFromPrediction(pre, spxAnchor)}
                {pre.as_of_pt ? (
                  <span className="text-fg-dim"> · recorded {fmtTimePt(String(pre.as_of_pt))} PT</span>
                ) : null}
              </>
            ) : undefined
          }
        />
        <Step
          title={PM_TIMELINE_STEPS[2].label}
          timePt={PM_TIMELINE_STEPS[2].timePt}
          status={
            openSnap ? (
              <span className="text-fg-subtle font-normal">Captured</span>
            ) : (
              <span className="text-fg-dim font-normal">Pending</span>
            )
          }
          detail={openPayload?.open_thesis?.summary ?? (openSnap ? 'Open snapshot stored.' : undefined)}
        />
        <Step
          title={PM_TIMELINE_STEPS[3].label}
          timePt={PM_TIMELINE_STEPS[3].timePt}
          status={
            signal ? (
              <span>
                {String(signal.recommended_side)}
                <HitMark ok={entryAligned} />
              </span>
            ) : (
              <span className="text-fg-dim font-normal">Pending</span>
            )
          }
          detail={
            signal?.reasoning
              ? `${String(signal.reasoning).slice(0, 200)}${
                  entryAligned
                    ? ' Entry aligns with premarket bias (counts toward morning grade).'
                    : ''
                }`
              : undefined
          }
        />
        <Step
          title={PM_TIMELINE_STEPS[4].label}
          timePt={PM_TIMELINE_STEPS[4].timePt}
          status={
            cp7 ? (
              <span>
                {String(cp7.thesis_status)}
                <HitMark ok={cp7Confirmed ? true : null} />
              </span>
            ) : (
              <span className="text-fg-dim font-normal">Pending</span>
            )
          }
          detail={cp7?.reasoning ? String(cp7.reasoning).slice(0, 160) : undefined}
        />
        <Step
          title={PM_TIMELINE_STEPS[5].label}
          timePt={PM_TIMELINE_STEPS[5].timePt}
          status={
            priceTarget ? (
              <span className={priceTarget.target_hit ? 'text-signal-buy' : 'text-signal-sell'}>
                {formatTargetLabel(priceTarget.target_spx, priceTarget.target_side)}{' '}
                {priceTarget.target_hit ? 'HIT' : 'MISS'}
                <HitMark ok={priceTarget.target_hit} />
              </span>
            ) : (
              <span className="text-fg-dim font-normal">Pending (~8:31 AM PT)</span>
            )
          }
          detail={
            priceTarget
              ? `Premarket locked SPX ${priceTarget.target_spx.toFixed(0)} (${priceTarget.target_side}). Window 6:30–8:30 AM PT: low ${priceTarget.window_low_spx?.toFixed(0) ?? '—'} / high ${priceTarget.window_high_spx?.toFixed(0) ?? '—'} (SPY×10 proxy).`
              : undefined
          }
        />
        <Step
          title={PM_TIMELINE_STEPS[6].label}
          timePt={PM_TIMELINE_STEPS[6].timePt}
          status={
            cp10 ? (
              <span>{String(cp10.thesis_status)}</span>
            ) : (
              <span className="text-fg-dim font-normal">Pending</span>
            )
          }
          detail={cp10?.reasoning ? String(cp10.reasoning).slice(0, 160) : undefined}
        />
        <Step
          title={PM_TIMELINE_STEPS[7].label}
          timePt={PM_TIMELINE_STEPS[7].timePt}
          status={
            morning.status === 'VALIDATED' ? (
              <span className="text-signal-buy">
                {morningGradeLabel(morning.status)}
                <HitMark ok />
              </span>
            ) : morning.status === 'FAILED' ? (
              <span className="text-signal-sell">{morningGradeLabel(morning.status)}</span>
            ) : (
              <span className="text-fg-subtle">{morningGradeLabel(morning.status)}</span>
            )
          }
          detail={morning.summary}
        />
        <Step
          title={PM_TIMELINE_STEPS[8].label}
          timePt={PM_TIMELINE_STEPS[8].timePt}
          muted
          status={
            outcome ? (
              <>
                <span className={directionTextCls(String(outcome.actual_direction ?? 'NEUTRAL'))}>
                  {String(outcome.actual_direction ?? '—')}
                </span>
                {moveSummary ? (
                  <span className="text-fg-dim font-normal block text-xs mt-1">
                    {moveSummary.spyChangeDollars >= 0 ? '+' : ''}
                    {moveSummary.spyChangeDollars.toFixed(2)} SPY · ~
                    {moveSummary.spxProxyPoints >= 0 ? '+' : ''}
                    {moveSummary.spxProxyPoints.toFixed(1)} SPX pts
                  </span>
                ) : null}
              </>
            ) : (
              <span className="text-fg-dim font-normal">Pending (after close)</span>
            )
          }
          detail={
            outcome && moveSummary
              ? `Reference only — full session close vs prior. ${formatOutcomeMoveLine(moveSummary)}`
              : outcome
                ? 'Reference only — full session close vs prior close (SPY proxy).'
                : undefined
          }
        />
      </ul>

      {inputSnaps.length > 0 ? (
        <details className="border border-border-subtle text-xs">
          <summary className="px-4 py-3 cursor-pointer text-fg-subtle hover:text-fg">
            Technical inputs ({inputSnaps.length} snapshots)
          </summary>
          <ul className="divide-y divide-border-subtle border-t border-border-subtle">
            {inputSnaps.map((s, i) => (
              <li key={`${s.snapshot_kind}-${i}`} className="px-4 py-2 flex justify-between gap-3">
                <span>{snapshotKindLabel(s.snapshot_kind)}</span>
                <span className="text-fg-dim tabular-nums shrink-0">{fmtTimePt(s.as_of_pt)} PT</span>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  );
}
