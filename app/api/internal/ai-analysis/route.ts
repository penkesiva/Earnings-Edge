/**
 * POST /api/internal/ai-analysis
 *
 * Receives brief data, builds a comprehensive trading prompt, and streams
 * a GPT-4o response back via Server-Sent Events.
 *
 * Called only from the brief page on demand — never during batch scans.
 */
import { NextRequest } from 'next/server';

export const maxDuration = 120;

const SYSTEM_PROMPT = `Act like a professional earnings trader and options analyst.

I will provide:
1. Stock ticker
2. Earnings data
3. Options flow
4. IV rank
5. News/sentiment

Your job:
- Think independently.
- Do NOT simply repeat the data.
- Combine fundamentals, options flow, IV environment, institutional behavior, historical reaction patterns, and sentiment.
- Estimate post-earnings move direction and magnitude.

Analyze:
1. Beat/miss probability
2. Guidance expectations
3. Institutional positioning
4. Call vs put flow quality
5. IV crush implications
6. Whether move is already priced in
7. Probability of squeeze or sell-the-news
8. Risk/reward asymmetry
9. Whether market makers are likely leaning bullish or bearish
10. Historical personality of the stock after earnings

Then provide:
- Final directional prediction
- Estimated percentage move
- Estimated dollar move
- Expected trading range after earnings
- Confidence score (1–10)

Format:
- Keep reasoning concise but intelligent.
- No hedging language unless necessary.
- Speak like a serious trader.
- End with ONE final prediction sentence.

Important:
- If IV is extremely high, explain whether selling premium is smarter than buying options.
- Distinguish between bullish stock movement and bullish options strategy.
- If data is mixed, state which signal dominates and why.
- Avoid generic advice.
- Make the strongest probabilistic estimate possible.`;

function buildUserMessage(brief: Record<string, unknown>): string {
  const lines: string[] = [];
  const pc = brief.put_call_ratio as number | null;
  const raw = brief.raw_fmp as Record<string, unknown> | null;
  const overhangs = (raw?.screamUnresolvedOverhangs as Array<Record<string, unknown>> | undefined) ?? [];

  lines.push(`## Ticker: ${brief.ticker}  |  Earnings: ${brief.earnings_date}`);
  lines.push('');

  lines.push(`## Beat Probability Score: ${brief.composite_score}/100`);
  lines.push('Components (0–100 each):');
  lines.push(`  Beat streak history     : ${brief.beat_streak_score ?? '—'}`);
  lines.push(`  EPS surprise magnitude  : ${brief.surprise_magnitude_score ?? '—'}`);
  lines.push(`  Analyst revision trend  : ${brief.revision_trend_score ?? '—'}`);
  lines.push(`  Whisper vs consensus    : ${brief.whisper_delta_score ?? '—'}`);
  lines.push(`  IV rank score           : ${brief.iv_rank_score ?? '—'}`);
  lines.push(`  Sector momentum (5d)    : ${brief.sector_momentum_score ?? '—'}`);
  lines.push(`  Insider buying (90d)    : ${brief.insider_score ?? '—'}`);
  lines.push('');

  lines.push('## Options Environment');
  lines.push(`  IV Rank         : ${brief.iv_rank ?? '—'}`);
  lines.push(`  IV 30d          : ${brief.iv_30d != null ? `${((brief.iv_30d as number) * 100).toFixed(1)}%` : '—'}`);
  lines.push(`  Expected Move   : ±$${(brief.expected_move_dollar as number | null)?.toFixed(2) ?? '—'} (±${(brief.expected_move_pct as number | null)?.toFixed(1) ?? '—'}%)`);
  lines.push(`  Put/Call Ratio  : ${pc?.toFixed(2) ?? '—'} — ${pc == null ? 'no data' : pc < 0.7 ? 'strongly call-heavy (bullish flow)' : pc < 0.9 ? 'slight call lean' : pc <= 1.1 ? 'balanced' : pc <= 1.4 ? 'slight put lean' : 'strongly put-heavy (bearish flow)'}`);
  lines.push('');

  lines.push('## Options Chain Analysis (Scream Test)');
  lines.push(`  Direction : ${(brief.scream_direction as string | null)?.toUpperCase() ?? 'NONE'}`);
  lines.push(`  Score     : ${brief.scream_score ?? 0}/5 conviction filters passed`);
  lines.push(`  Qualifies : ${brief.scream_qualifies ? 'YES — strong institutional positioning detected' : 'NO — mixed or insufficient chain signal'}`);
  if (brief.scream_notes) {
    const notes = (brief.scream_notes as string).split('\n').slice(0, 3).join('; ');
    lines.push(`  Notes     : ${notes}`);
  }
  lines.push('');

  lines.push('## System Recommendation');
  lines.push(`  Action    : ${brief.final_action ?? 'N/A'}`);
  if (brief.final_action_rationale) {
    lines.push(`  Rationale : ${brief.final_action_rationale}`);
  }
  lines.push('');

  if (overhangs.length > 0) {
    lines.push(`## News & Sentiment Risks (${overhangs.length} unresolved)`);
    for (const o of overhangs) {
      lines.push(`  [S${o.severity ?? '?'} ${o.category}] ${o.description}`);
    }
  } else {
    lines.push('## News & Sentiment: CLEAN — no material risks detected in recent headlines');
  }

  return lines.join('\n');
}

export async function POST(req: NextRequest) {
  const key = process.env.OPENAI_API_KEY;
  if (!key) {
    return new Response(
      JSON.stringify({ error: 'OPENAI_API_KEY not configured' }),
      { status: 503, headers: { 'Content-Type': 'application/json' } }
    );
  }

  let brief: Record<string, unknown>;
  try {
    brief = await req.json();
  } catch {
    return new Response('Invalid JSON', { status: 400 });
  }

  const userMessage = buildUserMessage(brief);

  const upstream = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'gpt-4o',
      stream: true,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user',   content: userMessage },
      ],
      max_tokens: 1500,
      temperature: 0.25,
    }),
    // No cache — always fresh analysis
    cache: 'no-store',
  });

  if (!upstream.ok) {
    const err = await upstream.text();
    return new Response(JSON.stringify({ error: err }), {
      status: 502,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Pipe the OpenAI SSE stream directly back to the client
  return new Response(upstream.body, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-store',
      'X-Accel-Buffering': 'no',
    },
  });
}
