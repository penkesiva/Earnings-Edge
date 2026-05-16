/**
 * POST /api/internal/gemini-analysis
 *
 * Same prompt as /api/internal/ai-analysis but routed through
 * Google Gemini 3.1 Pro Preview with SSE streaming.
 */
import { NextRequest } from 'next/server';
import type { AiBriefPayload } from '@/components/AiBriefAnalysis';
import { buildAiBriefUserMessage } from '@/lib/aiBriefMessage';

export const maxDuration = 120;

// Re-export the shared prompt and message builder — defined here to keep
// the two routes self-contained and avoid a circular import with the component.

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

export async function POST(req: NextRequest) {
  try {
    const key = process.env.GEMINI_API_KEY;
    if (!key) {
      return new Response(
        JSON.stringify({ error: 'GEMINI_API_KEY not configured' }),
        { status: 503, headers: { 'Content-Type': 'application/json' } }
      );
    }

    let brief: AiBriefPayload;
    try {
      brief = await req.json();
    } catch {
      return new Response('Invalid JSON', { status: 400 });
    }

    const userMessage = buildAiBriefUserMessage(brief);

    // Gemini streaming: alt=sse returns SSE events
    const model = 'gemini-3.1-pro-preview';
    const upstream = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:streamGenerateContent?key=${key}&alt=sse`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          system_instruction: { parts: [{ text: SYSTEM_PROMPT }] },
          contents: [{ parts: [{ text: userMessage }] }],
          generationConfig: { maxOutputTokens: 2500 },
        }),
        cache: 'no-store',
      }
    );

    if (!upstream.ok) {
      const err = await upstream.text();
      return new Response(JSON.stringify({ error: err }), {
        status: 502,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Pipe Gemini SSE stream to client — client parses Gemini's JSON format
    return new Response(upstream.body, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-store',
        'X-Accel-Buffering': 'no',
      },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[gemini-analysis] unhandled error:', msg);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
