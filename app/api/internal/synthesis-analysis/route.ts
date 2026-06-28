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
  parseSynthesisResponse,
} from '@/lib/aiConsensus';
import { parseScanRequestBody } from '@/lib/parseScanRequest';
import { assertScanRunAllowed } from '@/lib/tickerScanLock';
import { isAuthApiResult, requireAuthApi } from '@/lib/authServer';

export const maxDuration = 60;

const SYSTEM_PROMPT = `You are the chief risk officer synthesizing independent views on an earnings trade:
1) Quantitative system (beat score, scream test, reconciled action)
2) GPT analyst
3) Gemini analyst
4) Claude analyst
5) Optional whale/analyst screenshot intel (OCR from user-uploaded images — same ticker validated; supplemental flow/positioning only)

Your job is ONE authoritative verdict for a solo trader — not a summary of each model.

Definitions:
- GO = take a defined-risk trade aligned with the consensus direction (spread or premium sell/buy as appropriate for IV).
- NO-GO = skip the trade — mixed models, conflicting signals, or no edge after IV/positioning.
- WATCH = lean exists but conviction is insufficient; paper-trade or wait for post-earnings setup.

Rules:
- Weight all inputs; screenshot intel is optional context — can confirm or contradict chain/headlines; treat as stale if unclear.
- When whale/screenshot intel appears in the user message, WHALE must not be — ; WHY must mention it (confirm, contradict, or neutral).
- When no whale intel in the user message, set WHALE: —
- Do not ignore the system when 3 LLMs agree but system screams conflict (→ NO-GO or WATCH).
- When 3/3 LLMs agree on direction AND system leans same way → strong lean; use GO only when beat score/quality also supports it.
- System SKIP_CONFLICT or SKIP_ASYMMETRIC_* caps the verdict at NO-GO/WATCH unless beat score ≥70 and model confidence is ≥8/10.
- Beat score <70 caps directional consensus at WATCH unless confidence is ≥8/10 and the system is not a skip.
- IV rank ≥ 80: favor premium-selling structures over naked long options unless unanimous high-confidence directional GO.
- If the system or 2+ analysts prefer premium selling, do not output a debit spread; use the credit spread direction or NONE.
- Separate beat probability from stock direction (sell-the-news is valid).
- If models split on UP vs DOWN → NO-GO.
- Be decisive. No hedging paragraphs.

Output STRICTLY this format (plain text, no markdown):

VERDICT: GO | NO-GO | WATCH
DIRECTION: UP | DOWN | NEUTRAL
MOVE: [one line: dollar range | % range | target price, e.g. -$7 to -$11 | -9% to -13% | target ~$68]
CONFIDENCE: N/10
WHY: [one short sentence, max 25 words — dominant edge only; if whale intel provided, cite it explicitly]
WHALE: [one line — how screenshot/flow intel affects the call, or — if none provided]
TRADE TYPE: [structure name, e.g. CALL CREDIT SPREAD | PUT DEBIT SPREAD | IRON CONDOR | NONE]
TRADE EXPIRY: [YYYY-MM-DD from system legs, or —]
TRADE LEG 1: [BUY|SELL] [CALL|PUT] $[strike]  (or — if no trade)
TRADE LEG 2: [BUY|SELL] [CALL|PUT] $[strike]  (or —)
TRADE LEG 3: [optional — condors only, or —]
TRADE LEG 4: [optional — condors only, or —]
TRADE LIMIT: [limit price: ~$X.XX credit/debit per spread + max risk, or —]

TRADE rules:
- Use dollar strikes anchored to spot ± expected move from the system brief. Prefer system suggested_structure legs when they fit the verdict.
- NO-GO or WATCH → TRADE TYPE: NONE and all legs/limit as —.
- No prose ("such as", "sized small"). Only executable legs and a limit hint.
- IV rank ≥ 80: prefer credit spreads / premium sell over naked long options unless unanimous high-confidence directional GO.

Do not add ALIGNMENT or any fields beyond the lines above.`;

function replaceLine(text: string, key: string, value: string): string {
  const re = new RegExp(`^${key}:\\s*.*$`, 'im');
  return re.test(text) ? text.replace(re, `${key}: ${value}`) : `${text}\n${key}: ${value}`;
}

function noneTrade(text: string): string {
  let out = text;
  out = replaceLine(out, 'TRADE TYPE', 'NONE');
  out = replaceLine(out, 'TRADE EXPIRY', '—');
  out = replaceLine(out, 'TRADE LEG 1', '—');
  out = replaceLine(out, 'TRADE LEG 2', '—');
  out = replaceLine(out, 'TRADE LEG 3', '—');
  out = replaceLine(out, 'TRADE LEG 4', '—');
  out = replaceLine(out, 'TRADE LIMIT', '—');
  return out;
}

function countPremiumSellPreferences(
  brief: AiBriefPayload,
  analyses: Partial<Record<'openai' | 'gemini' | 'claude', string>>,
): number {
  const systemPrefersPremium =
    brief.final_action === 'PUT_CREDIT_SPREAD' ||
    brief.final_action === 'CALL_CREDIT_SPREAD' ||
    brief.final_action === 'IRON_CONDOR' ||
    /sell premium|credit spread|sell vol/i.test(brief.final_action_rationale ?? '');

  const modelVotes = Object.values(analyses).filter(text =>
    /sell premium|credit spread|put credit|call credit|bull put|bear call|sell (?:out-of-the-money |otm )?(?:puts|calls)/i
      .test(text ?? '')
  ).length;

  return (systemPrefersPremium ? 1 : 0) + modelVotes;
}

function guardSynthesisText(
  text: string,
  brief: AiBriefPayload,
  analyses: Partial<Record<'openai' | 'gemini' | 'claude', string>>,
  pre: ReturnType<typeof computeDeterministicConsensus>,
): string {
  const parsed = parseSynthesisResponse(text);
  let out = text;

  const action = brief.final_action ?? '';
  const score = brief.composite_score ?? 0;
  const avgConfidence = pre.avgConfidence ?? 0;
  const systemSkip = action.startsWith('SKIP');
  const exceptionalGo = score >= 70 && avgConfidence >= 8;
  const lowQualityGo = score > 0 && score < 70 && avgConfidence < 8;
  const tradeType = parsed.tradePlan?.type?.toUpperCase() ?? '';
  const isDebitSpread = /\b(?:CALL|PUT) DEBIT SPREAD\b/.test(tradeType);
  const premiumSellVotes = countPremiumSellPreferences(brief, analyses);

  if (parsed.verdict === 'GO' && systemSkip && !exceptionalGo) {
    out = replaceLine(out, 'VERDICT', action === 'SKIP_CONFLICT' ? 'NO-GO' : 'WATCH');
    out = replaceLine(out, 'CONFIDENCE', `${Math.min(6, Math.max(3, Math.round(avgConfidence || 5)))}/10`);
    out = replaceLine(
      out,
      'WHY',
      'System skip/asymmetric-risk guard blocks GO despite directional model alignment.'
    );
    out = noneTrade(out);
  } else if (parsed.verdict === 'GO' && lowQualityGo) {
    out = replaceLine(out, 'VERDICT', 'WATCH');
    out = replaceLine(out, 'CONFIDENCE', `${Math.min(6, Math.max(3, Math.round(avgConfidence || 5)))}/10`);
    out = replaceLine(
      out,
      'WHY',
      'Directional lean is not strong enough for GO with a sub-70 beat score.'
    );
    out = noneTrade(out);
  }

  if (isDebitSpread && premiumSellVotes >= 2) {
    out = replaceLine(out, 'VERDICT', 'WATCH');
    out = replaceLine(
      out,
      'WHY',
      'Premium-selling consensus blocks debit-spread entry; wait or use the system credit structure.'
    );
    out = noneTrade(out);
  }

  return out;
}

export async function POST(req: NextRequest) {
  const auth = await requireAuthApi();
  if (!isAuthApiResult(auth)) return auth;

  const key = process.env.OPENAI_API_KEY;
  if (!key) {
    return NextResponse.json({ error: 'OPENAI_API_KEY not configured' }, { status: 503 });
  }

  let body: {
    brief?: AiBriefPayload;
    analyses?: Partial<Record<'openai' | 'gemini' | 'claude', string>>;
    scan_run_id?: string;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const parsed = body.brief
    ? { brief: body.brief, scan_run_id: body.scan_run_id }
    : parseScanRequestBody(body);
  if ('error' in parsed) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }

  const { brief, scan_run_id: scanRunId } = parsed;
  const { analyses } = body;
  if (!brief?.ticker || !analyses) {
    return NextResponse.json({ error: 'brief and analyses required' }, { status: 400 });
  }

  const denied = await assertScanRunAllowed(auth.sb, auth.user.id, brief.ticker, scanRunId);
  if (denied) return denied;

  const filled = (['openai', 'gemini', 'claude'] as const).filter(p => analyses[p]?.trim());
  if (filled.length < 2) {
    return NextResponse.json(
      { error: 'Need at least 2 completed AI analyses before synthesizing' },
      { status: 400 }
    );
  }

  const systemSummary = buildSystemSummary(brief);
  const pre = computeDeterministicConsensus(brief, analyses);
  const hasWhaleIntel = !!brief.whale_intel?.summary?.trim();

  const userParts = [
    '## System (quant + options chain)',
    systemSummary,
    '',
    `## Pre-vote (deterministic): ${pre.verdict} ${pre.direction ?? ''} — ${pre.alignment}`,
    '',
  ];

  if (hasWhaleIntel) {
    userParts.push(
      '## Whale / analyst screenshot intel (user-uploaded, ticker-validated OCR)',
      brief.whale_intel!.summary.trim(),
      '',
      'Treat whale intel as a first-class signal — reflect it in WHALE and WHY.',
      '',
    );
  }

  for (const p of filled) {
    userParts.push(`## ${p.toUpperCase()} analysis`, analyses[p]!.trim(), '');
  }

  userParts.push(
    hasWhaleIntel
      ? 'Produce the final VERDICT block now (WHALE line required).'
      : 'Produce the final VERDICT block now.',
  );

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
      max_completion_tokens: 600,
      reasoning_effort: 'low',
    }),
    cache: 'no-store',
  });

  if (!upstream.ok) {
    const err = await upstream.text();
    return NextResponse.json({ error: err }, { status: 502 });
  }

  const json = await upstream.json();
  const rawText =
    (json.choices?.[0]?.message?.content as string | undefined)?.trim() ?? '';

  if (!rawText) {
    return NextResponse.json({ error: 'Empty synthesis response' }, { status: 502 });
  }

  const text = guardSynthesisText(rawText, brief, analyses, pre);

  return NextResponse.json({ text, preVote: pre });
}
