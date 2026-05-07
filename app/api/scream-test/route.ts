import { NextRequest, NextResponse } from 'next/server';
import { computeScreamTest, type ScreamTestInputs } from '@/lib/screamTest';

/**
 * POST /api/scream-test
 * Body: ScreamTestInputs
 * Returns: ScreamTestResult
 */
export async function POST(req: NextRequest) {
  try {
    const inputs = (await req.json()) as ScreamTestInputs;

    if (!inputs.ticker || typeof inputs.spot !== 'number') {
      return NextResponse.json(
        { error: 'Missing required fields: ticker, spot' },
        { status: 400 }
      );
    }

    const result = computeScreamTest(inputs);
    return NextResponse.json(result);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
