import type { AiBriefPayload } from '@/components/AiBriefAnalysis';

export type Direction = 'UP' | 'DOWN' | 'NEUTRAL';
export type VerdictCall = 'GO' | 'NO-GO' | 'WATCH';

/** Tailwind tokens for verdict badges — GO is colored by direction (bearish GO = red). */
export type VerdictBadgeStyle = { bg: string; text: string; border: string };

export function directionBadgeStyle(direction: Direction | null): VerdictBadgeStyle {
  if (direction === 'UP') {
    return { bg: 'bg-signal-buy/10', text: 'text-signal-buy', border: 'border-signal-buy/40' };
  }
  if (direction === 'DOWN') {
    return { bg: 'bg-signal-sell/10', text: 'text-signal-sell', border: 'border-signal-sell/40' };
  }
  return { bg: 'bg-bg-elevated', text: 'text-fg-muted', border: 'border-border' };
}

export function finalVerdictBadgeStyle(
  verdict: VerdictCall,
  direction: Direction | null
): VerdictBadgeStyle {
  if (verdict === 'NO-GO') return directionBadgeStyle('DOWN');
  if (verdict === 'WATCH') {
    return { bg: 'bg-signal-watch/10', text: 'text-signal-watch', border: 'border-signal-watch/40' };
  }
  if (verdict === 'GO') {
    if (direction === 'DOWN') return directionBadgeStyle('DOWN');
    if (direction === 'UP') return directionBadgeStyle('UP');
    return { bg: 'bg-signal-watch/10', text: 'text-signal-watch', border: 'border-signal-watch/40' };
  }
  return directionBadgeStyle(null);
}

export function finalVerdictTextCls(verdict: VerdictCall, direction: Direction | null): string {
  return finalVerdictBadgeStyle(verdict, direction).text;
}

export function finalVerdictPanelBorder(verdict: VerdictCall, direction: Direction | null): string {
  const s = finalVerdictBadgeStyle(verdict, direction);
  return `${s.border} ${s.bg}`;
}

export interface ParsedVerdict {
  direction: Direction;
  confidence: number | null;
  targetPrice: number | null;
}

const BULLISH_ACTIONS = new Set([
  'LONG_CALL', 'CALL_DEBIT_SPREAD', 'PUT_CREDIT_SPREAD', 'BULLISH_WATCH',
  'SKIP_ASYMMETRIC_UPSIDE_RISK',
]);
const BEARISH_ACTIONS = new Set([
  'LONG_PUT', 'PUT_DEBIT_SPREAD', 'CALL_CREDIT_SPREAD', 'BEARISH_WATCH',
  'SKIP_ASYMMETRIC_DOWNSIDE_RISK',
]);

export function systemDirectionFromBrief(brief: AiBriefPayload): Direction | null {
  const action = brief.final_action;
  if (!action) return null;
  if (BULLISH_ACTIONS.has(action)) return 'UP';
  if (BEARISH_ACTIONS.has(action)) return 'DOWN';
  if (action === 'IRON_CONDOR') return 'NEUTRAL';
  return null;
}

export function parseAiVerdict(text: string): ParsedVerdict | null {
  const direction =
    text.match(/Direction:\s*(UP|DOWN)/i)?.[1]?.toUpperCase() as Direction | undefined ??
    text.match(/moves\s+(UP|DOWN)/i)?.[1]?.toUpperCase() as Direction | undefined;
  if (!direction) return null;

  const confMatch = text.match(/Confidence:\s*(\d+)\s*\/\s*10/i);
  const targetMatch =
    text.match(/target\s*~?\$?([\d.]+)/i) ??
    text.match(/around\s*\$?([\d.]+)/i);

  return {
    direction,
    confidence: confMatch ? Math.min(10, Math.max(1, parseInt(confMatch[1], 10))) : null,
    targetPrice: targetMatch ? parseFloat(targetMatch[1]) : null,
  };
}

export function buildSystemSummary(brief: AiBriefPayload): string {
  const lean = systemDirectionFromBrief(brief);
  const leanFixed =
    lean === 'UP' ? 'BULLISH' : lean === 'DOWN' ? 'BEARISH' : lean === 'NEUTRAL' ? 'NEUTRAL' : 'UNCLEAR';

  const parts = [
    `Ticker ${brief.ticker}, earnings ${brief.earnings_date}`,
    `Beat score ${brief.composite_score}/100`,
    `Final action: ${brief.final_action ?? 'none'} (${leanFixed})`,
    `IV rank ${brief.iv_rank ?? '—'} | P/C ratio ${brief.put_call_ratio?.toFixed(2) ?? '—'}`,
    `Expected move: ±$${brief.expected_move_dollar?.toFixed(2) ?? '—'} (${brief.expected_move_pct?.toFixed(1) ?? '—'}%)`,
    `Scream test: ${brief.scream_score ?? 0}/5 ${brief.scream_direction ?? 'none'}, qualifies=${brief.scream_qualifies}`,
  ];
  if (brief.final_action_rationale) parts.push(`Rationale: ${brief.final_action_rationale}`);
  return parts.join('\n');
}

export interface DeterministicConsensus {
  verdict: VerdictCall;
  direction: Direction | null;
  alignment: string;
  avgConfidence: number | null;
  votes: { system: Direction | null; models: Direction[] };
}

/** Fast pre-synthesis vote — surfaces in API prompt and UI hints. */
export function computeDeterministicConsensus(
  brief: AiBriefPayload,
  analyses: Partial<Record<'openai' | 'gemini' | 'claude', string>>
): DeterministicConsensus {
  const system = systemDirectionFromBrief(brief);
  const modelDirs: Direction[] = [];
  const confidences: number[] = [];

  for (const text of Object.values(analyses)) {
    if (!text) continue;
    const p = parseAiVerdict(text);
    if (p) {
      modelDirs.push(p.direction);
      if (p.confidence != null) confidences.push(p.confidence);
    }
  }

  const allVotes = [system, ...modelDirs].filter((d): d is Direction => d != null);
  const up = allVotes.filter(d => d === 'UP').length;
  const down = allVotes.filter(d => d === 'DOWN').length;
  const neutral = allVotes.filter(d => d === 'NEUTRAL').length;
  const total = allVotes.length;

  let direction: Direction | null = null;
  if (up > down && up >= down + 1) direction = 'UP';
  else if (down > up && down >= up + 1) direction = 'DOWN';
  else if (neutral > 0 && up === down) direction = 'NEUTRAL';

  const unanimous = (direction === 'UP' && up === total) || (direction === 'DOWN' && down === total);
  const strong = direction != null && Math.max(up, down) >= 3 && total >= 3;

  const skip =
    brief.final_action?.startsWith('SKIP') &&
    brief.final_action !== 'SKIP_ASYMMETRIC_DOWNSIDE_RISK' &&
    brief.final_action !== 'SKIP_ASYMMETRIC_UPSIDE_RISK';

  const split = up > 0 && down > 0;
  const avgConfidence =
    confidences.length > 0
      ? Math.round((confidences.reduce((a, b) => a + b, 0) / confidences.length) * 10) / 10
      : null;

  let verdict: VerdictCall = 'WATCH';
  if (split || (skip && !strong)) verdict = 'NO-GO';
  else if (strong || unanimous) verdict = 'GO';
  else if (direction && Math.max(up, down) >= 2) verdict = 'WATCH';

  const alignment =
    total === 0
      ? 'no votes'
      : direction
        ? `${Math.max(up, down)}/${total} aligned ${direction}${system && modelDirs.length ? ' (system + models)' : ''}`
        : `${total} sources split`;

  return {
    verdict,
    direction,
    alignment,
    avgConfidence,
    votes: { system, models: modelDirs },
  };
}

export type AlignmentChip = {
  label: string;
  status: 'yes' | 'no' | 'missing';
};

const MODEL_LABELS = { openai: 'GPT', gemini: 'Gemini', claude: 'Claude' } as const;

/** Deterministic alignment row — System + each model tick for the verdict direction. */
export function buildAlignmentChips(
  brief: AiBriefPayload,
  analyses: Partial<Record<'openai' | 'gemini' | 'claude', string>>,
  consensusDirection: Direction | null
): { summary: string; chips: AlignmentChip[] } {
  const chips: AlignmentChip[] = [];
  const systemDir = systemDirectionFromBrief(brief);

  chips.push({
    label: 'System',
    status:
      systemDir == null ? 'missing' :
      consensusDirection == null || consensusDirection === 'NEUTRAL' ? 'no' :
      systemDir === consensusDirection ? 'yes' : 'no',
  });

  for (const p of ['openai', 'gemini', 'claude'] as const) {
    const text = analyses[p];
    if (!text?.trim()) {
      chips.push({ label: MODEL_LABELS[p], status: 'missing' });
      continue;
    }
    const v = parseAiVerdict(text);
    chips.push({
      label: MODEL_LABELS[p],
      status:
        !v || !consensusDirection || consensusDirection === 'NEUTRAL' ? 'no' :
        v.direction === consensusDirection ? 'yes' : 'no',
    });
  }

  const dirLabel = consensusDirection?.toLowerCase() ?? 'mixed';
  const aligned = chips.filter(c => c.status === 'yes').length;
  const summary = `${aligned}/${chips.length} ${dirLabel}`;

  return { summary, chips };
}

export interface ParsedSynthesis {
  verdict: VerdictCall;
  direction: Direction | null;
  move: string | null;
  confidence: string | null;
  why: string | null;
  trade: string | null;
  raw: string;
}

/** Reasoning after "4. Best trade" from a single-model analysis (saved syntheses may lack WHY). */
export function extractModelReasoning(text: string): string | null {
  const m = text.match(/\n4\.\s*Best trade:\s*[^\n]+\n+([\s\S]+)/i);
  if (!m?.[1]) return null;
  const block = m[1]
    .replace(/\*\*/g, '')
    .replace(/\n+/g, ' ')
    .trim();
  if (block.length < 24) return null;
  const sentences = block.match(/[^.!?]+[.!?]+/g) ?? [block];
  return sentences.slice(0, 2).join(' ').trim().slice(0, 320) || null;
}

/** WHY from synthesis, else first available model reasoning snippet. */
export function resolveVerdictWhy(
  parsed: ParsedSynthesis,
  analyses: Partial<Record<'openai' | 'gemini' | 'claude', string>>,
): string | null {
  if (parsed.why?.trim()) return parsed.why.trim();
  for (const p of ['openai', 'gemini', 'claude'] as const) {
    const r = analyses[p] ? extractModelReasoning(analyses[p]!) : null;
    if (r) return r;
  }
  return null;
}

export function parseSynthesisResponse(text: string): ParsedSynthesis {
  const line = (key: string) => {
    const m = text.match(new RegExp(`^${key}:\\s*(.+)$`, 'im'));
    return m?.[1]?.trim() ?? null;
  };

  const verdictRaw = line('VERDICT')?.toUpperCase() ?? '';
  const verdict: VerdictCall =
    verdictRaw.includes('NO-GO') || verdictRaw.includes('NO GO') ? 'NO-GO' :
    verdictRaw.includes('WATCH') ? 'WATCH' :
    verdictRaw.includes('GO') ? 'GO' : 'WATCH';

  const dirRaw = line('DIRECTION')?.toUpperCase() ?? '';
  const direction: Direction | null =
    dirRaw.includes('DOWN') ? 'DOWN' :
    dirRaw.includes('UP') ? 'UP' :
    dirRaw.includes('NEUTRAL') ? 'NEUTRAL' : null;

  return {
    verdict,
    direction,
    move: line('MOVE'),
    confidence: line('CONFIDENCE'),
    why: line('WHY'),
    trade: line('TRADE'),
    raw: text,
  };
}
