/**
 * POST /api/internal/claude-analysis
 *
 * Same prompt as the other analysis routes but routed through
 * Anthropic Claude Opus 4.7 with SSE streaming.
 *
 * Anthropic SSE delta format:
 *   event: content_block_delta
 *   data: { type, index, delta: { type: "text_delta", text: "..." } }
 */
import { NextRequest } from 'next/server';
import type { AiBriefPayload } from '@/components/AiBriefAnalysis';

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
- Always separate three distinct judgments:
  1. Good company? (business quality, moat, balance sheet — irrelevant to short-term reaction)
  2. Good earnings? (did it beat EPS/revenue vs consensus — necessary but not sufficient)
  3. Good stock reaction? (will the stock actually move up — depends on positioning, expectations already priced in, guidance, and market sentiment)
  A company can have great earnings and still sell off. A weak beat on an oversold stock can rip. Focus on #3 — that is the only thing that makes or loses money.
- If IV is extremely high, explain whether selling premium is smarter than buying options.
- Distinguish between bullish stock movement and bullish options strategy.
- If data is mixed, state which signal dominates and why.
- Avoid generic advice.
- Make the strongest probabilistic estimate possible.

---

Now compress everything into a final trader call.

STRICT FORMAT — follow exactly, no deviation:

START with this line (fill in the values):
My final call: [TICKER] moves [UP/DOWN] $X to $Y after earnings, closing around $Z[, optional one-clause caveat if critical].

Then give the summary on separate lines, NO markdown bold or asterisks:
1. Direction: UP or DOWN
2. Move: -$X to -$Y  |  -X% to -Y%  |  target ~$Z
3. Confidence: N/10
4. Best trade: [one concise sentence]

Then 2–3 sentences of reasoning. No headers, no bullet points, no markdown.

Rules:
- Final call sentence comes FIRST, always.
- Items 2 combines dollar move, % move, and target price on one line separated by |
- No ** or markdown formatting anywhere.
- Plain text only.`;

function buildUserMessage(brief: AiBriefPayload): string {
  const lines: string[] = [];
  const pc = brief.put_call_ratio;

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
  lines.push(`  IV 30d          : ${brief.iv_30d != null ? `${(brief.iv_30d * 100).toFixed(1)}%` : '—'}`);
  lines.push(`  Expected Move   : ±$${brief.expected_move_dollar?.toFixed(2) ?? '—'} (±${brief.expected_move_pct?.toFixed(1) ?? '—'}%)`);
  lines.push(`  Put/Call Ratio  : ${pc?.toFixed(2) ?? '—'} — ${pc == null ? 'no data' : pc < 0.7 ? 'strongly call-heavy (bullish flow)' : pc < 0.9 ? 'slight call lean' : pc <= 1.1 ? 'balanced' : pc <= 1.4 ? 'slight put lean' : 'strongly put-heavy (bearish flow)'}`);
  lines.push('');
  lines.push('## Options Chain Analysis (Scream Test)');
  lines.push(`  Direction : ${brief.scream_direction?.toUpperCase() ?? 'NONE'}`);
  lines.push(`  Score     : ${brief.scream_score ?? 0}/5 conviction filters passed`);
  lines.push(`  Qualifies : ${brief.scream_qualifies ? 'YES — strong institutional positioning detected' : 'NO — mixed or insufficient chain signal'}`);
  if (brief.scream_notes) {
    const raw = brief.scream_notes;
    const notes = Array.isArray(raw)
      ? (raw as string[]).slice(0, 3).join('; ')
      : String(raw).split('\n').slice(0, 3).join('; ');
    lines.push(`  Notes     : ${notes}`);
  }
  lines.push('');
  lines.push('## System Recommendation');
  lines.push(`  Action    : ${brief.final_action ?? 'N/A'}`);
  if (brief.final_action_rationale) lines.push(`  Rationale : ${brief.final_action_rationale}`);
  lines.push('');
  const overhangs = brief.overhangs ?? [];
  if (overhangs.length > 0) {
    lines.push(`## News & Sentiment Risks (${overhangs.length} unresolved)`);
    for (const o of overhangs) lines.push(`  [S${o.severity ?? '?'} ${o.category}] ${o.description}`);
  } else {
    lines.push('## News & Sentiment: CLEAN — no material risks detected in recent headlines');
  }

  const headlines = brief.raw_headlines ?? [];
  if (headlines.length > 0) {
    lines.push('');
    lines.push(`## Raw News Headlines (${headlines.length} total, oldest first)`);
    lines.push('Use these to form your own independent view — do not just echo back the classified risks above.');
    for (const h of headlines) {
      lines.push(`  (${h.date}) ${h.title}`);
    }
  }

  return lines.join('\n');
}

export async function POST(req: NextRequest) {
  try {
    const key = process.env.ANTHROPIC_API_KEY;
    if (!key) {
      return new Response(
        JSON.stringify({ error: 'ANTHROPIC_API_KEY not configured' }),
        { status: 503, headers: { 'Content-Type': 'application/json' } }
      );
    }

    let brief: AiBriefPayload;
    try {
      brief = await req.json();
    } catch {
      return new Response('Invalid JSON', { status: 400 });
    }

    const userMessage = buildUserMessage(brief);

    const upstream = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-opus-4-7',
        max_tokens: 1500,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: userMessage }],
        stream: true,
      }),
      cache: 'no-store',
    });

    if (!upstream.ok) {
      const err = await upstream.text();
      return new Response(JSON.stringify({ error: err }), {
        status: 502,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Pipe Anthropic SSE stream to client — client handles the Anthropic delta format
    return new Response(upstream.body, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-store',
        'X-Accel-Buffering': 'no',
      },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[claude-analysis] unhandled error:', msg);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
