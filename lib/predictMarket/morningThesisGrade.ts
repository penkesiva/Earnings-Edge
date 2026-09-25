import type { EntryRecommendation, ThesisStatus } from '@/lib/predictMarket/types';

export type MorningThesisStatus = 'VALIDATED' | 'PARTIAL' | 'FAILED' | 'PENDING' | 'N/A';

export type MorningThesisGrade = {
  status: MorningThesisStatus;
  entrySide: EntryRecommendation | null;
  entryAligned: boolean | null;
  checkpoint7: ThesisStatus | null;
  checkpoint7Confirmed: boolean;
  summary: string;
  /** Primary score for premarket forecast — entry + 7 AM confirmation. */
  premarketHit: boolean | null;
};

function entryMatchesBias(
  entrySide: string | null,
  tradeBias: string | null,
): boolean | null {
  if (!entrySide || entrySide === 'WAIT' || entrySide === 'NO_TRADE') return false;
  if (tradeBias === 'CALL' && entrySide === 'CALL') return true;
  if (tradeBias === 'PUT' && entrySide === 'PUT') return true;
  if (tradeBias === 'NO_TRADE') return null;
  return false;
}

/** User-facing primary grade: premarket thesis + entry window + 7 AM check (not EOD close). */
export function computeMorningThesisGrade(input: {
  premarketDirection: string | null;
  tradeBias: string | null;
  entrySide: string | null;
  checkpoint7Status: string | null;
}): MorningThesisGrade {
  const entrySide = (input.entrySide as EntryRecommendation | null) ?? null;
  const checkpoint7 = (input.checkpoint7Status as ThesisStatus | null) ?? null;
  const checkpoint7Confirmed = checkpoint7 === 'CONFIRMED';
  const entryAligned = entryMatchesBias(entrySide, input.tradeBias);

  const dir = input.premarketDirection;
  if (!dir || dir === 'NEUTRAL' || input.tradeBias === 'NO_TRADE') {
    return {
      status: 'N/A',
      entrySide,
      entryAligned,
      checkpoint7,
      checkpoint7Confirmed,
      summary: 'No directional premarket thesis to validate.',
      premarketHit: null,
    };
  }

  if (!entrySide && !checkpoint7) {
    return {
      status: 'PENDING',
      entrySide,
      entryAligned,
      checkpoint7,
      checkpoint7Confirmed,
      summary: 'Waiting for entry signal and 7 AM check.',
      premarketHit: null,
    };
  }

  if (entryAligned && checkpoint7Confirmed) {
    return {
      status: 'VALIDATED',
      entrySide,
      entryAligned: true,
      checkpoint7,
      checkpoint7Confirmed: true,
      summary: `Morning thesis validated — entry ${entrySide} and 7 AM CONFIRMED align with ${dir} / ${input.tradeBias} forecast.`,
      premarketHit: true,
    };
  }

  if (checkpoint7 === 'INVALIDATED' || checkpoint7 === 'REVERSING') {
    return {
      status: 'FAILED',
      entrySide,
      entryAligned,
      checkpoint7,
      checkpoint7Confirmed: false,
      summary: `Morning thesis failed — 7 AM ${checkpoint7}.`,
      premarketHit: false,
    };
  }

  if (entryAligned === false || checkpoint7 === 'WEAKENING') {
    return {
      status: 'PARTIAL',
      entrySide,
      entryAligned,
      checkpoint7,
      checkpoint7Confirmed: false,
      summary: 'Morning thesis mixed — entry or 7 AM did not fully confirm.',
      premarketHit: false,
    };
  }

  return {
    status: 'PENDING',
    entrySide,
    entryAligned,
    checkpoint7,
    checkpoint7Confirmed,
    summary: 'Morning thesis not fully scored yet.',
    premarketHit: null,
  };
}

export function morningGradeLabel(status: MorningThesisStatus): string {
  switch (status) {
    case 'VALIDATED':
      return 'Validated';
    case 'PARTIAL':
      return 'Partial';
    case 'FAILED':
      return 'Failed';
    case 'N/A':
      return 'N/A';
    default:
      return 'Pending';
  }
}
