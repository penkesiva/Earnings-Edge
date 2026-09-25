import type { SupabaseClient } from '@supabase/supabase-js';
import { isTradingDay } from '@/lib/usMarketCalendar';
import { scoreDirectionForecast } from '@/lib/predictMarket/outcomeGrading';
import type { MorningThesisGrade } from '@/lib/predictMarket/morningThesisGrade';
import { computeMorningThesisGrade } from '@/lib/predictMarket/morningThesisGrade';

export type PredictMarketCalendarCell = {
  date: string;
  dayNum: number;
  tradingDay: boolean;
  hasSession: boolean;
  premarketPredicted: string | null;
  nightPredicted: string | null;
  actualDirection: string | null;
  premarketCorrect: boolean | null;
  nightCorrect: boolean | null;
  graded: boolean;
  dailyReturnPercent: number | null;
};

export type PredictMarketCalendarMonth = {
  month: string;
  monthLabel: string;
  prevMonth: string;
  nextMonth: string;
  weeks: Array<Array<PredictMarketCalendarCell | null>>;
};

const PT = 'America/Los_Angeles';

function parseMonth(raw: string | undefined): { year: number; month: number } {
  if (raw && /^\d{4}-\d{2}$/.test(raw)) {
    const [y, m] = raw.split('-').map(Number);
    if (m >= 1 && m <= 12) return { year: y, month: m };
  }
  const now = new Date();
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: PT,
    year: 'numeric',
    month: '2-digit',
  }).formatToParts(now);
  const y = Number(parts.find(p => p.type === 'year')?.value);
  const m = Number(parts.find(p => p.type === 'month')?.value);
  return { year: y, month: m };
}

function isoMonth(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, '0')}`;
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function shiftMonth(year: number, month: number, delta: number): { year: number; month: number } {
  const d = new Date(Date.UTC(year, month - 1 + delta, 1));
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1 };
}

function mondayFirstIndex(isoDate: string): number {
  const dow = new Date(`${isoDate}T12:00:00Z`).getUTCDay();
  return (dow + 6) % 7;
}

function directionMatch(predicted: string | null, actual: string | null): boolean | null {
  if (!predicted || !actual) return null;
  if (actual !== 'GREEN' && actual !== 'RED' && actual !== 'NEUTRAL') return null;
  return scoreDirectionForecast(predicted, actual as 'GREEN' | 'RED' | 'NEUTRAL');
}

type PredBundle = {
  night: { id: string; direction: string } | null;
  pre: { id: string; direction: string } | null;
  preCorrect: boolean | null;
  nightCorrect: boolean | null;
};

export async function loadSessionCalendarMonth(
  sb: SupabaseClient,
  monthParam?: string,
): Promise<PredictMarketCalendarMonth> {
  const { year, month } = parseMonth(monthParam);
  const monthKey = isoMonth(year, month);
  const start = `${monthKey}-01`;
  const end = `${monthKey}-${String(daysInMonth(year, month)).padStart(2, '0')}`;

  const prev = shiftMonth(year, month, -1);
  const next = shiftMonth(year, month, 1);

  const monthLabel = new Date(`${start}T12:00:00Z`).toLocaleDateString('en-US', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });

  const probe = await sb.from('pm_market_sessions').select('id', { head: true, count: 'exact' });
  if (probe.error && /relation|does not exist/i.test(probe.error.message)) {
    return {
      month: monthKey,
      monthLabel,
      prevMonth: isoMonth(prev.year, prev.month),
      nextMonth: isoMonth(next.year, next.month),
      weeks: buildEmptyWeeks(year, month),
    };
  }

  const { data: sessions } = await sb
    .from('pm_market_sessions')
    .select('id, session_date')
    .gte('session_date', start)
    .lte('session_date', end);

  const sessionByDate = new Map<string, string>();
  for (const s of sessions ?? []) {
    sessionByDate.set(s.session_date as string, s.id as string);
  }

  const sessionIds = [...sessionByDate.values()];
  const outcomeBySession = new Map<
    string,
    { actual_direction: string; daily_return_percent: number | null; payload?: unknown }
  >();
  const predsBySession = new Map<string, PredBundle>();

  if (sessionIds.length > 0) {
    const [{ data: outcomes }, { data: preds }, { data: signals }, { data: cps7 }] =
      await Promise.all([
      sb
        .from('pm_market_outcomes')
        .select('session_id, actual_direction, daily_return_percent, payload')
        .in('session_id', sessionIds),
      sb
        .from('pm_predictions')
        .select('id, session_id, prediction_type, direction, trade_bias')
        .in('session_id', sessionIds),
      sb.from('pm_trade_signals').select('session_id, recommended_side').in('session_id', sessionIds),
      sb
        .from('pm_validation_checkpoints')
        .select('session_id, thesis_status')
        .in('session_id', sessionIds)
        .eq('checkpoint_kind', 'FIRST_7AM'),
    ]);

    for (const o of outcomes ?? []) {
      outcomeBySession.set(o.session_id as string, {
        actual_direction: o.actual_direction as string,
        daily_return_percent:
          o.daily_return_percent != null ? Number(o.daily_return_percent) : null,
        payload: o.payload,
      });
    }

    const entryBySession = new Map(
      (signals ?? []).map(s => [s.session_id as string, s.recommended_side as string]),
    );
    const cp7BySession = new Map(
      (cps7 ?? []).map(c => [c.session_id as string, c.thesis_status as string]),
    );

    for (const id of sessionIds) {
      predsBySession.set(id, {
        night: null,
        pre: null,
        preCorrect: null,
        nightCorrect: null,
      });
    }
    for (const p of preds ?? []) {
      const sid = p.session_id as string;
      const entry = predsBySession.get(sid)!;
      if (p.prediction_type === 'NIGHT') {
        entry.night = { id: p.id as string, direction: p.direction as string };
      }
      if (p.prediction_type === 'PREMARKET') {
        entry.pre = { id: p.id as string, direction: p.direction as string };
        (entry as PredBundle & { tradeBias?: string }).tradeBias = p.trade_bias as string;
      }
    }

    const predIds = (preds ?? []).map(p => p.id as string);
    const scoreByPredId = new Map<string, boolean | null>();
    if (predIds.length > 0) {
      const { data: scores } = await sb
        .from('pm_prediction_scores')
        .select('prediction_id, direction_correct')
        .in('prediction_id', predIds);
      for (const s of scores ?? []) {
        scoreByPredId.set(s.prediction_id as string, s.direction_correct as boolean | null);
      }
    }

    for (const [sid, bundle] of predsBySession) {
      const outcome = outcomeBySession.get(sid);
      const payload = outcome?.payload as { morning_thesis?: MorningThesisGrade } | undefined;
      const ext = bundle as PredBundle & { tradeBias?: string };
      const computed = computeMorningThesisGrade({
        premarketDirection: bundle.pre?.direction ?? null,
        tradeBias: ext.tradeBias ?? null,
        entrySide: entryBySession.get(sid) ?? null,
        checkpoint7Status: cp7BySession.get(sid) ?? null,
      });
      const morningHit = payload?.morning_thesis?.premarketHit ?? computed.premarketHit;

      bundle.preCorrect =
        morningHit != null
          ? morningHit
          : bundle.pre
            ? (scoreByPredId.get(bundle.pre.id) ??
              directionMatch(bundle.pre.direction, outcome?.actual_direction ?? null))
            : null;
      bundle.nightCorrect = bundle.night
        ? (scoreByPredId.get(bundle.night.id) ??
          directionMatch(bundle.night.direction, outcome?.actual_direction ?? null))
        : null;
    }
  }

  const cells: PredictMarketCalendarCell[] = [];
  const last = daysInMonth(year, month);
  for (let day = 1; day <= last; day++) {
    const date = `${monthKey}-${String(day).padStart(2, '0')}`;
    const sessionId = sessionByDate.get(date);
    const tradingDay = isTradingDay(date);
    const outcome = sessionId ? outcomeBySession.get(sessionId) : undefined;
    const preds = sessionId ? predsBySession.get(sessionId) : undefined;

    cells.push({
      date,
      dayNum: day,
      tradingDay,
      hasSession: Boolean(sessionId),
      premarketPredicted: preds?.pre?.direction ?? null,
      nightPredicted: preds?.night?.direction ?? null,
      actualDirection: outcome?.actual_direction ?? null,
      premarketCorrect: preds?.preCorrect ?? null,
      nightCorrect: preds?.nightCorrect ?? null,
      graded: Boolean(outcome),
      dailyReturnPercent: outcome?.daily_return_percent ?? null,
    });
  }

  return {
    month: monthKey,
    monthLabel,
    prevMonth: isoMonth(prev.year, prev.month),
    nextMonth: isoMonth(next.year, next.month),
    weeks: packWeeks(cells, year, month),
  };
}

function buildEmptyWeeks(year: number, month: number): Array<Array<PredictMarketCalendarCell | null>> {
  const monthKey = isoMonth(year, month);
  const last = daysInMonth(year, month);
  const cells: PredictMarketCalendarCell[] = [];
  for (let day = 1; day <= last; day++) {
    const date = `${monthKey}-${String(day).padStart(2, '0')}`;
    cells.push({
      date,
      dayNum: day,
      tradingDay: isTradingDay(date),
      hasSession: false,
      premarketPredicted: null,
      nightPredicted: null,
      actualDirection: null,
      premarketCorrect: null,
      nightCorrect: null,
      graded: false,
      dailyReturnPercent: null,
    });
  }
  return packWeeks(cells, year, month);
}

function packWeeks(
  cells: PredictMarketCalendarCell[],
  year: number,
  month: number,
): Array<Array<PredictMarketCalendarCell | null>> {
  if (cells.length === 0) return [];
  const firstDate = `${isoMonth(year, month)}-01`;
  const pad = mondayFirstIndex(firstDate);
  const flat: Array<PredictMarketCalendarCell | null> = [...Array(pad).fill(null), ...cells];
  const weeks: Array<Array<PredictMarketCalendarCell | null>> = [];
  for (let i = 0; i < flat.length; i += 7) {
    const week = flat.slice(i, i + 7);
    while (week.length < 7) week.push(null);
    weeks.push(week);
  }
  return weeks;
}
