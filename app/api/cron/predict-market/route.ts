/**
 * PredictMarket cron phases (Pacific targets). Vercel crons are UTC — schedules assume PDT.
 * See lib/predictMarket/sessionCalendar.ts and /status manifest notes.
 */

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { runPredictMarketPhase } from '@/lib/predictMarket/jobs/runPredictMarketPhase';
import type { PredictMarketPhase } from '@/lib/predictMarket/types';
import { isPacificTimeNear } from '@/lib/predictMarket/sessionCalendar';

export const maxDuration = 300;

const PHASES: PredictMarketPhase[] = [
  'night',
  'premarket',
  'open',
  'entry',
  'validate_7am',
  'validate_10am',
  'validate_price_2h',
  'grade',
];

function parsePhase(raw: string | null): PredictMarketPhase | null {
  if (!raw) return null;
  return PHASES.includes(raw as PredictMarketPhase) ? (raw as PredictMarketPhase) : null;
}

export async function GET(req: NextRequest) {
  const auth = req.headers.get('authorization');
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const phase = parsePhase(req.nextUrl.searchParams.get('phase'));
  if (!phase) {
    return NextResponse.json(
      { error: 'Missing or invalid ?phase=', allowed: PHASES },
      { status: 400 },
    );
  }

  const skipTimeCheck = req.nextUrl.searchParams.get('force') === '1';
  if (!skipTimeCheck) {
    const ok = phaseTimeGuard(phase);
    if (!ok) {
      return NextResponse.json({ skipped: 'outside PT window', phase });
    }
  }

  const sb = supabaseAdmin();
  const result = await runPredictMarketPhase(sb, phase);
  return NextResponse.json(result, { status: result.ok ? 200 : 500 });
}

function phaseTimeGuard(phase: PredictMarketPhase): boolean {
  switch (phase) {
    case 'night':
      return isPacificTimeNear(21, 0);
    case 'premarket':
      return isPacificTimeNear(6, 10);
    case 'open':
      return isPacificTimeNear(6, 30);
    case 'entry':
      return isPacificTimeNear(6, 45);
    case 'validate_7am':
      return isPacificTimeNear(7, 0);
    case 'validate_10am':
      return isPacificTimeNear(10, 0);
    case 'validate_price_2h':
      return isPacificTimeNear(8, 31);
    case 'grade':
      return isPacificTimeNear(13, 15);
    default:
      return false;
  }
}
