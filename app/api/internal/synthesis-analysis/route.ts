/**
 * POST /api/internal/synthesis-analysis
 *
 * Meta-judge: combines system signals + OpenAI/Gemini/Claude analyses into one GO/NO-GO verdict.
 * Non-streaming JSON response for a compact final card.
 */
import { NextRequest, NextResponse } from 'next/server';
import type { AiBriefPayload } from '@/components/AiBriefAnalysis';
import {
  buildSystemSummary,
  computeDeterministicConsensus,
} from '@/lib/aiConsensus';

export const maxDuration = 60;

const SYSTEM_PROMPT = `You are the chief risk officer synthesizing four independent views on an earnings trade:
1) Quantitative system (beat score, scream test, reconciled action)
2) GPT analyst
3) Gemini analyst
4) Claude analyst

Your job is ONE authoritative verdict for a solo trader — not a summary of each model.

Definitions:
- GO = take a defined-risk trade aligned with the consensus direction (spread or premium sell/buy as appropriate for IV).
- NO-GO = skip the trade — mixed models, conflicting signals, or no edge after IV/positioning.
- WATCH = lean exists but conviction is insufficient; paper-trade or wait for post-earnings setup.

Rules:
- Weight all four inputs; do not ignore the system when 3 LLMs agree but system screams conflict (→ NO-GO or WATCH).
- When 3/3 LLMs agree on direction AND system leans same way → strong GO.
- IV rank ≥ 80: favor premium-selling structures over naked long options unless unanimous high-confidence directional GO.
- Separate beat probability from stock direction (sell-the-news is valid).
- If models split on UP vs DOWN → NO-GO.
- Be decisive. No hedging paragraphs.

Output STRICTLY this format (plain text, no markdown):

VERDICT: GO | NO-GO | WATCH
DIRECTION: UP | DOWN | NEUTRAL
MOVE: [one line: dollar range | % range | target price, e.g. -$7 to -$11 | -9% to -13% | target ~$68]
CONFIDENCE: N/10
TRADE: [one sentence — specific structure]

Do not add ALIGNMENT, WHY, or any extra paragraphs.`;

export async function POST(req: NextRequest) {
  const key = process.env.OPENAI_API_KEY;
  if (!key) {
    return NextResponse.json({ error: 'OPENAI_API_KEY not configured' }, { status: 503 });
  }

  let body: {
    brief?: AiBriefPayload;
    analyses?: Partial<Record<'openai' | 'gemini' | 'claude', string>>;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const { brief, analyses } = body;
  if (!brief?.ticker || !analyses) {
    return NextResponse.json({ error: 'brief and analyses required' }, { status: 400 });
  }

  const filled = (['openai', 'gemini', 'claude'] as const).filter(p => analyses[p]?.trim());
  if (filled.length < 2) {
    return NextResponse.json(
      { error: 'Need at least 2 completed AI analyses before synthesizing' },
      { status: 400 }
    );
  }

  const systemSummary = buildSystemSummary(brief);
  const pre = computeDeterministicConsensus(brief, analyses);

  const userParts = [
    '## System (quant + options chain)',
    systemSummary,
    '',
    `## Pre-vote (deterministic): ${pre.verdict} ${pre.direction ?? ''} — ${pre.alignment}`,
    '',
  ];

  for (const p of filled) {
    userParts.push(`## ${p.toUpperCase()} analysis`, analyses[p]!.trim(), '');
  }

  userParts.push('Produce the final VERDICT block now.');

  const upstream = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'gpt-5.5',
      stream: false,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userParts.join('\n') },
      ],
      max_completion_tokens: 500,
      reasoning_effort: 'low',
    }),
    cache: 'no-store',
  });

  if (!upstream.ok) {
    const err = await upstream.text();
    return NextResponse.json({ error: err }, { status: 502 });
  }

  const json = await upstream.json();
  const text =
    (json.choices?.[0]?.message?.content as string | undefined)?.trim() ?? '';

  if (!text) {
    return NextResponse.json({ error: 'Empty synthesis response' }, { status: 502 });
  }

  return NextResponse.json({ text, preVote: pre });
}
