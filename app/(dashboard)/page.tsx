import { Suspense } from 'react';
import { requireAuthSession } from '@/lib/authServer';
import { loadDashboardBriefAiByIds } from '@/lib/loadDashboardBriefAi';
import {
  buildTopEarningsPicks,
  buildYearRoundTopPicks,
  getPreMarketFocusDates,
  YEAR_ROUND_PICK_HORIZON_DAYS,
} from '@/lib/topEarningsPicks';
import { addCalendarDays, earningsSessionDate } from '@/lib/earningsDate';
import { getHomeWeekdaySlots } from '@/lib/usMarketCalendar';
import { FearGreedIndex, FearGreedIndexSkeleton } from '@/components/FearGreedIndex';
import {
  TopEarningsPicksPanel,
  TopYearRoundPicksPanel,
} from '@/components/TopEarningsPicksPanel';
import { UpcomingWeekList } from '@/components/UpcomingWeekList';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

type CalendarEvent = {
  id: string;
  ticker: string;
  earnings_date: string;
  timing: string | null;
};

type SessionBrief = {
  id: string;
  ticker: string;
  earnings_date: string;
  composite_score: number;
  updated_at: string | null;
  generated_at: string | null;
  expected_move_dollar: number | null;
  expected_move_pct: number | null;
};

function buildUpcomingByDate(
  sessionDates: string[],
  events: CalendarEvent[],
  briefs: SessionBrief[],
): Record<string, CalendarEvent[]> {
  return Object.fromEntries(
    sessionDates.map(date => {
      const dayEvents = events.filter(e => e.earnings_date === date);
      const dayBriefs = briefs.filter(b => b.earnings_date === date);
      const tickers = new Set([
        ...dayEvents.map(e => e.ticker),
        ...dayBriefs.map(b => b.ticker),
      ]);

      const rows = [...tickers].map(ticker => {
        const existing = dayEvents.find(e => e.ticker === ticker);
        if (existing) return existing;
        const brief = dayBriefs.find(b => b.ticker === ticker)!;
        return {
          id: `brief-${brief.id}`,
          ticker,
          earnings_date: date,
          timing: null,
        };
      });

      rows.sort((a, b) => {
        const score = (t: string) =>
          dayBriefs.find(b => b.ticker === t)?.composite_score ?? -1;
        return score(b.ticker) - score(a.ticker);
      });

      return [date, rows];
    }),
  );
}

export default async function HomePage() {
  const { sb } = await requireAuthSession();
  const sessions = getHomeWeekdaySlots(5);
  const sessionDates = sessions.map(s => s.date);
  const focusDates = getPreMarketFocusDates(2);
  const today = earningsSessionDate();
  const yearRoundEnd = addCalendarDays(today, YEAR_ROUND_PICK_HORIZON_DAYS);

  const { data: activeWatchlist } = await sb
    .from('watchlist')
    .select('ticker')
    .eq('active', true);

  const activeTickers = new Set((activeWatchlist ?? []).map(w => w.ticker));

  const pickBriefSelect =
    'id, ticker, earnings_date, composite_score, scream_score, scream_qualifies, scream_direction, final_action, expected_move_pct';

  const { data: pickBriefs } = await sb
    .from('earnings_briefs')
    .select(pickBriefSelect)
    .gte('earnings_date', today)
    .lte('earnings_date', yearRoundEnd)
    .order('composite_score', { ascending: false });

  const { data: sessionEvents } = sessionDates.length
    ? await sb
        .from('earnings_events')
        .select('id, ticker, earnings_date, timing')
        .in('earnings_date', sessionDates)
        .order('earnings_date', { ascending: true })
    : { data: [] as CalendarEvent[] };

  const { data: sessionBriefs } = sessionDates.length
    ? await sb
        .from('earnings_briefs')
        .select(
          'id, ticker, earnings_date, composite_score, updated_at, generated_at, expected_move_dollar, expected_move_pct',
        )
        .in('earnings_date', sessionDates)
        .order('composite_score', { ascending: false })
    : { data: [] as SessionBrief[] };

  const briefByKey = new Map(
    (sessionBriefs ?? []).map(b => [`${b.earnings_date}:${b.ticker}`, b]),
  );

  const upcomingByDate = buildUpcomingByDate(
    sessionDates,
    sessionEvents ?? [],
    sessionBriefs ?? [],
  );

  const allBriefIds = [
    ...new Set([
      ...(pickBriefs ?? []).map(b => b.id),
      ...(sessionBriefs ?? []).map(b => b.id),
    ]),
  ];
  const aiMetaByBriefId = await loadDashboardBriefAiByIds(sb, allBriefIds);
  const topPicks = buildTopEarningsPicks(
    pickBriefs ?? [],
    aiMetaByBriefId,
    activeTickers,
    focusDates,
  );
  const yearRoundPicks = buildYearRoundTopPicks(
    pickBriefs ?? [],
    aiMetaByBriefId,
    activeTickers,
    focusDates,
    today,
  );
  const aiMetaFor = (briefId: string | undefined) =>
    briefId ? aiMetaByBriefId.get(briefId) ?? null : null;

  return (
    <div className="space-y-8 sm:space-y-12">
      <Suspense fallback={<FearGreedIndexSkeleton />}>
        <FearGreedIndex />
      </Suspense>

      <TopEarningsPicksPanel
        focusLabel={topPicks.focusLabel}
        bullish={topPicks.bullish}
        bearish={topPicks.bearish}
      />

      <TopYearRoundPicksPanel
        focusLabel={yearRoundPicks.focusLabel}
        bullish={yearRoundPicks.bullish}
        bearish={yearRoundPicks.bearish}
      />

      <UpcomingWeekList
        sessions={sessions}
        upcomingByDate={upcomingByDate}
        briefByKey={briefByKey}
        aiMetaFor={aiMetaFor}
      />
    </div>
  );
}
