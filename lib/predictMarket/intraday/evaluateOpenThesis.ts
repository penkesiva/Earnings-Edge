import type { MarketDataBundle } from '@/lib/predictMarket/providers/types';
import type { ActiveThesis } from '@/lib/predictMarket/intraday/sessionContext';
import { marketPreviousCloseSpx, marketSpxLevel } from '@/lib/predictMarket/intraday/sessionContext';

export type OpenThesisCheck = {
  spxLevel: number | null;
  previousClose: number | null;
  gapPercent: number | null;
  confirming: boolean | null;
  summary: string;
};

export function evaluateOpenThesis(
  thesis: ActiveThesis | null,
  bundle: MarketDataBundle,
): OpenThesisCheck {
  const spxLevel = marketSpxLevel(bundle);
  const previousClose = marketPreviousCloseSpx(bundle);
  const gapPercent =
    spxLevel != null && previousClose != null && previousClose > 0
      ? ((spxLevel - previousClose) / previousClose) * 100
      : null;

  if (!thesis || spxLevel == null || previousClose == null) {
    return {
      spxLevel,
      previousClose,
      gapPercent,
      confirming: null,
      summary: 'Insufficient data for open thesis check.',
    };
  }

  let confirming: boolean | null = null;
  if (thesis.direction === 'GREEN') {
    confirming = spxLevel >= previousClose;
  } else if (thesis.direction === 'RED') {
    confirming = spxLevel <= previousClose;
  }

  const summary = confirming
    ? `${thesis.direction} thesis initially confirming (gap ${gapPercent?.toFixed(2) ?? '?'}%).`
    : `${thesis.direction} thesis initially failing (gap ${gapPercent?.toFixed(2) ?? '?'}%).`;

  return { spxLevel, previousClose, gapPercent, confirming, summary };
}
