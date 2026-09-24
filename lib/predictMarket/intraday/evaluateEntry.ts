import type { EntryRecommendation } from '@/lib/predictMarket/types';
import type { MarketDataBundle } from '@/lib/predictMarket/providers/types';
import type { ActiveThesis } from '@/lib/predictMarket/intraday/sessionContext';
import { marketPreviousCloseSpx, marketSpxLevel } from '@/lib/predictMarket/intraday/sessionContext';

export type EntryEvaluation = {
  recommendedSide: EntryRecommendation;
  confidence: number | null;
  spxPrice: number | null;
  confirmationSignals: string[];
  invalidationLevel: number | null;
  reasoning: string;
};

export function evaluateEntryWindow(
  thesis: ActiveThesis | null,
  bundle: MarketDataBundle,
  openThesisConfirming: boolean | null,
): EntryEvaluation {
  const spxPrice = marketSpxLevel(bundle);
  const prevClose = marketPreviousCloseSpx(bundle);
  const signals: string[] = [];

  if (!thesis || spxPrice == null) {
    return {
      recommendedSide: 'NO_TRADE',
      confidence: null,
      spxPrice,
      confirmationSignals: ['missing_thesis_or_price'],
      invalidationLevel: null,
      reasoning: 'No active forecast or live SPX proxy price.',
    };
  }

  if (thesis.direction === 'NEUTRAL' || thesis.tradeBias === 'NO_TRADE') {
    return {
      recommendedSide: 'NO_TRADE',
      confidence: thesis.confidence,
      spxPrice,
      confirmationSignals: ['neutral_or_no_trade_bias'],
      invalidationLevel: prevClose,
      reasoning: 'Forecast is NEUTRAL or NO_TRADE — no directional entry.',
    };
  }

  if (prevClose != null) {
    if (thesis.direction === 'GREEN' && spxPrice > prevClose) {
      signals.push('holding_above_previous_close');
    }
    if (thesis.direction === 'RED' && spxPrice < prevClose) {
      signals.push('holding_below_previous_close');
    }
  }

  if (openThesisConfirming === true) signals.push('open_thesis_confirming');
  if (openThesisConfirming === false) signals.push('open_thesis_failing');

  const nq = bundle.nq?.changePct;
  if (nq != null) {
    if (thesis.direction === 'GREEN' && nq > 0) signals.push('nq_futures_positive');
    if (thesis.direction === 'RED' && nq < 0) signals.push('nq_futures_negative');
  }

  const invalidationLevel = prevClose;

  const confirmCount = signals.filter(
    s => !s.includes('failing') && s !== 'open_thesis_failing',
  ).length;
  const failing = signals.includes('open_thesis_failing');

  if (failing && confirmCount < 2) {
    return {
      recommendedSide: 'WAIT',
      confidence: Math.max(30, thesis.confidence - 15),
      spxPrice,
      confirmationSignals: signals,
      invalidationLevel,
      reasoning: 'Opening move contradicts thesis — wait for confirmation.',
    };
  }

  if (confirmCount >= 2 && thesis.tradeBias === 'CALL') {
    return {
      recommendedSide: 'CALL',
      confidence: thesis.confidence,
      spxPrice,
      confirmationSignals: signals,
      invalidationLevel,
      reasoning: 'Directional confirmation aligns with CALL bias.',
    };
  }

  if (confirmCount >= 2 && thesis.tradeBias === 'PUT') {
    return {
      recommendedSide: 'PUT',
      confidence: thesis.confidence,
      spxPrice,
      confirmationSignals: signals,
      invalidationLevel,
      reasoning: 'Directional confirmation aligns with PUT bias.',
    };
  }

  return {
    recommendedSide: 'WAIT',
    confidence: thesis.confidence,
    spxPrice,
    confirmationSignals: signals,
    invalidationLevel,
    reasoning: 'Mixed or insufficient confirmation — no entry yet.',
  };
}
