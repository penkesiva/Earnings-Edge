/**
 * End-of-day outcome labeling — SPY proxy, flat-day deadband, display helpers.
 */

/** |daily return| below this → NEUTRAL (avoid calling +0.01% days "GREEN"). */
export const ACTUAL_DIRECTION_DEADBAND_PCT = 0.1;

export type ActualDayDirection = 'GREEN' | 'RED' | 'NEUTRAL';

export function classifyActualDirection(dailyReturnPercent: number): ActualDayDirection {
  if (Math.abs(dailyReturnPercent) < ACTUAL_DIRECTION_DEADBAND_PCT) return 'NEUTRAL';
  return dailyReturnPercent > 0 ? 'GREEN' : 'RED';
}

export type OutcomeMoveSummary = {
  spyPreviousClose: number;
  spyClose: number;
  spyChangeDollars: number;
  spyChangePercent: number;
  spxProxyPoints: number;
};

export function summarizeOutcomeMove(previousClose: number, close: number): OutcomeMoveSummary {
  const spyChangeDollars = close - previousClose;
  const spyChangePercent = (spyChangeDollars / previousClose) * 100;
  return {
    spyPreviousClose: previousClose,
    spyClose: close,
    spyChangeDollars,
    spyChangePercent,
    spxProxyPoints: spyChangeDollars * 10,
  };
}

function signed(n: number, digits: number): string {
  const sign = n >= 0 ? '+' : '';
  return `${sign}${n.toFixed(digits)}`;
}

export function formatOutcomeMoveLine(move: OutcomeMoveSummary): string {
  return `Move: SPY ${signed(move.spyChangeDollars, 2)} (${signed(move.spyChangePercent, 3)}%) · ~${signed(move.spxProxyPoints, 1)} SPX pts (SPY×10 proxy).`;
}

/** Score RED/GREEN forecasts against actual; flat days exclude directional bets. */
export function scoreDirectionForecast(
  predicted: string,
  actual: ActualDayDirection,
): boolean | null {
  if (actual === 'NEUTRAL') {
    return predicted === 'NEUTRAL' ? true : null;
  }
  if (predicted !== 'GREEN' && predicted !== 'RED') return null;
  return predicted === actual;
}

export function formatFinalGradeDetail(
  outcome: {
    actual_direction: string | null;
    daily_return_percent: number | null;
    previous_close?: number | null;
    close?: number | null;
  },
  premarketPredicted: string | null,
  premarketCorrect: boolean | null,
): string {
  const dir = outcome.actual_direction ?? '—';
  const move =
    outcome.previous_close != null && outcome.close != null
      ? formatOutcomeMoveLine(summarizeOutcomeMove(outcome.previous_close, outcome.close))
      : outcome.daily_return_percent != null
        ? `Return ${signed(outcome.daily_return_percent, 3)}% (SPY proxy vs prior close).`
        : '';

  const parts: string[] = [];
  if (dir === 'NEUTRAL') {
    parts.push(
      `Flat day (NEUTRAL): move within ±${ACTUAL_DIRECTION_DEADBAND_PCT}% of prior close — not a meaningful up or down day.`,
    );
  } else {
    parts.push(`Directional day (${dir}): close materially ${dir === 'GREEN' ? 'above' : 'below'} prior close.`);
  }
  if (move) parts.push(move);

  if (premarketPredicted) {
    if (dir === 'NEUTRAL') {
      parts.push(
        premarketCorrect === true
          ? 'Premarket was NEUTRAL — matches flat outcome.'
          : `Premarket was ${premarketPredicted} on a flat day (not scored as a simple hit/miss).`,
      );
    } else if (premarketCorrect === true) {
      parts.push(`Premarket forecast ${premarketPredicted} matched the actual day.`);
    } else if (premarketCorrect === false) {
      parts.push(`Premarket forecast ${premarketPredicted} did not match (actual ${dir}).`);
    }
  }
  return parts.join(' ');
}
