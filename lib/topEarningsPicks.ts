import { parseSynthesisResponse, type Direction, type VerdictCall } from '@/lib/aiConsensus';
import type { DashboardBriefAiMeta } from '@/lib/loadDashboardBriefAi';
import { formatDayHeader, addCalendarDays, earningsSessionDate } from '@/lib/earningsDate';
import { getHomeWeekdaySlots } from '@/lib/usMarketCalendar';

export type TopPickBriefInput = {
  id: string;
  ticker: string;
  earnings_date: string;
  composite_score: number;
  scream_score: number | null;
  scream_qualifies: boolean | null;
  scream_direction: string | null;
  final_action: string | null;
  expected_move_pct: number | null;
};

export type TopPickRow = {
  briefId: string;
  ticker: string;
  earningsDate: string;
  compositeScore: number;
  screamScore: number | null;
  screamQualifies: boolean;
  verdict: VerdictCall | null;
  direction: 'UP' | 'DOWN';
  rankScore: number;
  expectedMovePct: number | null;
  hasConsensus: boolean;
};

export type TopPicksResult = {
  focusDates: string[];
  focusLabel: string;
  bullish: TopPickRow[];
  bearish: TopPickRow[];
};

/** Next N NYSE-open days for pre-earnings focus (default 2). */
export function getPreMarketFocusDates(count = 2, now = new Date()): string[] {
  return getHomeWeekdaySlots(12, now)
    .filter(s => s.marketOpen)
    .slice(0, count)
    .map(s => s.date);
}

export function classifyPickDirection(
  consensusText: string | null | undefined,
  screamDirection: string | null | undefined,
  finalAction: string | null | undefined,
): 'UP' | 'DOWN' | null {
  if (consensusText?.trim()) {
    const parsed = parseSynthesisResponse(consensusText);
    if (parsed.direction === 'UP' || parsed.direction === 'DOWN') {
      return parsed.direction;
    }
  }

  const scream = screamDirection?.toLowerCase();
  if (scream === 'bullish') return 'UP';
  if (scream === 'bearish') return 'DOWN';

  const action = finalAction ?? '';
  if (
    /LONG_CALL|CALL_DEBIT|PUT_CREDIT|BULLISH_WATCH|BULLISH/i.test(action) &&
    !/BEARISH|LONG_PUT|PUT_DEBIT|CALL_CREDIT/i.test(action)
  ) {
    return 'UP';
  }
  if (/LONG_PUT|PUT_DEBIT|CALL_CREDIT|BEARISH_WATCH|BEARISH/i.test(action)) {
    return 'DOWN';
  }

  return null;
}

export function computeTopPickRankScore(input: {
  compositeScore: number;
  screamQualifies: boolean;
  screamScore: number | null;
  verdict: VerdictCall | null;
  expectedMovePct: number | null;
  hasConsensus: boolean;
}): number {
  let score = input.compositeScore;
  if (input.screamQualifies) score += 12;
  if (input.screamScore != null) score += input.screamScore * 2.5;
  if (input.verdict === 'GO') score += 20;
  else if (input.verdict === 'WATCH') score += 8;
  if (input.hasConsensus) score += 5;
  if (input.expectedMovePct != null && input.expectedMovePct >= 4) score += 4;
  return Math.round(score * 10) / 10;
}

function collectTopPickRows(
  briefs: TopPickBriefInput[],
  aiMetaByBriefId: Map<string, DashboardBriefAiMeta>,
  activeTickers: Set<string>,
  includeDate: (earningsDate: string) => boolean,
): TopPickRow[] {
  const rows: TopPickRow[] = [];

  for (const brief of briefs) {
    if (!activeTickers.has(brief.ticker)) continue;
    if (!includeDate(brief.earnings_date)) continue;

    const meta = aiMetaByBriefId.get(brief.id);
    const consensusText = meta?.consensusText ?? null;
    const direction = classifyPickDirection(
      consensusText,
      brief.scream_direction,
      brief.final_action,
    );
    if (direction !== 'UP' && direction !== 'DOWN') continue;

    const parsed = consensusText ? parseSynthesisResponse(consensusText) : null;

    rows.push({
      briefId: brief.id,
      ticker: brief.ticker,
      earningsDate: brief.earnings_date,
      compositeScore: brief.composite_score ?? 0,
      screamScore: brief.scream_score,
      screamQualifies: !!brief.scream_qualifies,
      verdict: parsed?.verdict ?? null,
      direction,
      rankScore: computeTopPickRankScore({
        compositeScore: brief.composite_score ?? 0,
        screamQualifies: !!brief.scream_qualifies,
        screamScore: brief.scream_score,
        verdict: parsed?.verdict ?? null,
        expectedMovePct: brief.expected_move_pct,
        hasConsensus: !!consensusText,
      }),
      expectedMovePct: brief.expected_move_pct,
      hasConsensus: !!consensusText,
    });
  }

  return rows;
}

function splitTopRows(rows: TopPickRow[]): { bullish: TopPickRow[]; bearish: TopPickRow[] } {
  const bullish = rows
    .filter(r => r.direction === 'UP')
    .sort((a, b) => b.rankScore - a.rankScore || b.compositeScore - a.compositeScore)
    .slice(0, 10);

  const bearish = rows
    .filter(r => r.direction === 'DOWN')
    .sort((a, b) => b.rankScore - a.rankScore || b.compositeScore - a.compositeScore)
    .slice(0, 10);

  return { bullish, bearish };
}

function dedupeTopRowsByTicker(rows: TopPickRow[]): TopPickRow[] {
  const best = new Map<string, TopPickRow>();
  for (const row of rows) {
    const existing = best.get(row.ticker);
    if (!existing || row.rankScore > existing.rankScore) {
      best.set(row.ticker, row);
    }
  }
  return [...best.values()];
}

export const YEAR_ROUND_PICK_HORIZON_DAYS = 90;

export function buildTopEarningsPicks(
  briefs: TopPickBriefInput[],
  aiMetaByBriefId: Map<string, DashboardBriefAiMeta>,
  activeTickers: Set<string>,
  focusDates: string[],
): TopPicksResult {
  const focusSet = new Set(focusDates);
  const rows = collectTopPickRows(
    briefs,
    aiMetaByBriefId,
    activeTickers,
    date => focusSet.has(date),
  );
  const { bullish, bearish } = splitTopRows(rows);

  const focusLabel =
    focusDates.length === 0
      ? ''
      : focusDates.length === 1
        ? formatDayHeader(focusDates[0])
        : `${formatDayHeader(focusDates[0])} · ${formatDayHeader(focusDates[1])}`;

  return { focusDates, focusLabel, bullish, bearish };
}

/** Watchlist picks outside the pre-earnings window — one best brief per ticker. */
export function buildYearRoundTopPicks(
  briefs: TopPickBriefInput[],
  aiMetaByBriefId: Map<string, DashboardBriefAiMeta>,
  activeTickers: Set<string>,
  excludeDates: string[],
  today: string,
  horizonDays = YEAR_ROUND_PICK_HORIZON_DAYS,
): TopPicksResult {
  const exclude = new Set(excludeDates);
  const horizonEnd = addCalendarDays(today, horizonDays);

  const rows = dedupeTopRowsByTicker(
    collectTopPickRows(
      briefs,
      aiMetaByBriefId,
      activeTickers,
      date => date >= today && date <= horizonEnd && !exclude.has(date),
    ),
  );

  const { bullish, bearish } = splitTopRows(rows);

  return {
    focusDates: [],
    focusLabel: `Next ${horizonDays} days · outside earnings focus`,
    bullish,
    bearish,
  };
}
