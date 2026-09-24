import type { ThesisStatus } from '@/lib/predictMarket/types';
import type { MarketDataBundle } from '@/lib/predictMarket/providers/types';
import type { ActiveThesis } from '@/lib/predictMarket/intraday/sessionContext';
import { marketPreviousCloseSpx, marketSpxLevel } from '@/lib/predictMarket/intraday/sessionContext';

export type CheckpointEvaluation = {
  thesisStatus: ThesisStatus;
  metrics: Record<string, unknown>;
  reasoning: string;
};

export function evaluateCheckpoint(
  thesis: ActiveThesis | null,
  bundle: MarketDataBundle,
  kind: 'FIRST_7AM' | 'MIDDAY_10AM',
): CheckpointEvaluation {
  const spx = marketSpxLevel(bundle);
  const prev = marketPreviousCloseSpx(bundle);
  const changePct =
    spx != null && prev != null && prev > 0 ? ((spx - prev) / prev) * 100 : null;

  const metrics: Record<string, unknown> = {
    spx_proxy: spx,
    previous_close_spx: prev,
    change_pct: changePct,
    nq_change_pct: bundle.nq?.changePct ?? null,
    checkpoint: kind,
  };

  if (!thesis || spx == null || prev == null || changePct == null) {
    return {
      thesisStatus: 'PENDING',
      metrics,
      reasoning: 'Missing thesis or price data.',
    };
  }

  if (thesis.direction === 'NEUTRAL') {
    return {
      thesisStatus: 'PENDING',
      metrics,
      reasoning: 'Neutral forecast — no directional thesis to validate.',
    };
  }

  const aligned =
    thesis.direction === 'GREEN' ? changePct > 0.05 : changePct < -0.05;
  const opposed =
    thesis.direction === 'GREEN' ? changePct < -0.15 : changePct > 0.15;

  let thesisStatus: ThesisStatus = 'WEAKENING';
  if (aligned) thesisStatus = 'CONFIRMED';
  if (opposed) thesisStatus = 'INVALIDATED';

  if (kind === 'MIDDAY_10AM' && aligned && Math.abs(changePct) > 0.35) {
    thesisStatus = 'CONFIRMED';
  }
  if (kind === 'MIDDAY_10AM' && opposed) {
    thesisStatus = 'REVERSING';
  }

  return {
    thesisStatus,
    metrics,
    reasoning: `${thesis.direction} thesis ${thesisStatus.toLowerCase()} at ${changePct.toFixed(2)}% vs prior close (SPX proxy).`,
  };
}
