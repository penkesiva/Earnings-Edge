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

/** UP / DOWN / NEUTRAL from model or synthesis text; null if unknown. */
export function parseAiDirection(text: string): Direction | null {
  const fromLine = text.match(/Direction:\s*(UP|DOWN|NEUTRAL)/i)?.[1]?.toUpperCase();
  if (fromLine === 'UP' || fromLine === 'DOWN' || fromLine === 'NEUTRAL') {
    return fromLine;
  }
  const fromCall = text.match(/moves\s+(UP|DOWN)/i)?.[1]?.toUpperCase();
  if (fromCall === 'UP' || fromCall === 'DOWN') return fromCall;
  return null;
}

export function parseAiVerdict(text: string): ParsedVerdict | null {
  const direction = parseAiDirection(text);
  if (!direction || direction === 'NEUTRAL') return null;

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
    `Spot (scan): $${brief.spot_price?.toFixed(2) ?? '—'}`,
    `Beat score ${brief.composite_score}/100`,
    `Final action: ${brief.final_action ?? 'none'} (${leanFixed})`,
    `IV rank ${brief.iv_rank ?? '—'} | P/C ratio ${brief.put_call_ratio?.toFixed(2) ?? '—'}`,
    `Expected move: ±$${brief.expected_move_dollar?.toFixed(2) ?? '—'} (${brief.expected_move_pct?.toFixed(1) ?? '—'}%)`,
    `Scream test: ${brief.scream_score ?? 0}/5 ${brief.scream_direction ?? 'none'}, qualifies=${brief.scream_qualifies}`,
  ];
  if (brief.final_action_rationale) parts.push(`Rationale: ${brief.final_action_rationale}`);

  if (brief.whale_intel?.summary?.trim()) {
    parts.push('');
    parts.push('Whale / analyst screenshot intel (OCR, same-ticker validated):');
    parts.push(brief.whale_intel.summary.replace(/\n/g, '\n  '));
  }

  const structure = brief.suggested_structure;
  if (structure?.action && structure.action !== 'SKIP') {
    parts.push(`Suggested structure: ${structure.action.replace(/_/g, ' ')}`);
    if (structure.preferredExpiry) parts.push(`Preferred expiry: ${structure.preferredExpiry}`);
    for (const leg of structure.legs ?? []) {
      parts.push(`  ${leg.side} ${leg.type} $${leg.strike}${leg.expiry ? ` exp ${leg.expiry}` : ''}`);
    }
  }

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

  const action = brief.final_action ?? '';
  const skip = action.startsWith('SKIP');
  const score = brief.composite_score ?? 0;

  const split = up > 0 && down > 0;
  const avgConfidence =
    confidences.length > 0
      ? Math.round((confidences.reduce((a, b) => a + b, 0) / confidences.length) * 10) / 10
      : null;
  const lowQualityGo = score > 0 && score < 70 && (avgConfidence == null || avgConfidence < 8);

  let verdict: VerdictCall = 'WATCH';
  if (split || (skip && !strong)) verdict = 'NO-GO';
  else if (skip || lowQualityGo) verdict = direction ? 'WATCH' : 'NO-GO';
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
  /** UP / DOWN / NEUTRAL from that source; null if no report or unparseable. */
  direction: Direction | null;
};

const MODEL_LABELS = { openai: 'GPT', gemini: 'Gemini', claude: 'Claude' } as const;

/** True when screenshot OCR was part of this verdict (session or saved WHALE line). */
export function hasWhaleIntelForAlignment(
  brief: AiBriefPayload,
  whaleLine?: string | null,
): boolean {
  if (brief.whale_intel?.summary?.trim()) return true;
  const w = whaleLine?.trim();
  return !!w && w !== '—' && w !== '-';
}

/** Bullish/bearish lean from whale OCR or synthesis WHALE line (best-effort). */
export function inferWhaleDirection(intel: string | null | undefined): Direction | null {
  if (!intel?.trim()) return null;
  const t = intel.toLowerCase();
  if (/\bcalls side\b/.test(t)) return 'UP';
  if (/\bputs side\b/.test(t)) return 'DOWN';
  if (/\bneutral\b/.test(t)) return 'NEUTRAL';
  const bull =
    /\b(call-heavy|call heavy|bullish|call sweep|calls? sweep|heavy call|more calls|upside|long calls?)\b/.test(
      t,
    ) ||
    (/\bcalls?\b/.test(t) && !/\bputs?\b/.test(t));
  const bear =
    /\b(put-heavy|put heavy|bearish|put sweep|puts? sweep|heavy put|more puts|downside|long puts?)\b/.test(
      t,
    ) ||
    (/\bputs?\b/.test(t) && !/\bcalls?\b/.test(t));
  if (bull && bear) return 'NEUTRAL';
  if (bull) return 'UP';
  if (bear) return 'DOWN';
  return null;
}

/** Per-source direction row — System + models + optional Whale intel. */
export function buildAlignmentChips(
  brief: AiBriefPayload,
  analyses: Partial<Record<'openai' | 'gemini' | 'claude', string>>,
  consensusDirection: Direction | null,
  options?: { whaleLine?: string | null },
): { summary: string; chips: AlignmentChip[] } {
  const chips: AlignmentChip[] = [];
  const systemDir = systemDirectionFromBrief(brief);

  chips.push({ label: 'System', direction: systemDir });

  for (const p of ['openai', 'gemini', 'claude'] as const) {
    const text = analyses[p];
    if (!text?.trim()) {
      chips.push({ label: MODEL_LABELS[p], direction: null });
      continue;
    }
    chips.push({ label: MODEL_LABELS[p], direction: parseAiDirection(text) });
  }

  if (hasWhaleIntelForAlignment(brief, options?.whaleLine)) {
    const intel = options?.whaleLine ?? brief.whale_intel?.summary ?? '';
    chips.push({ label: 'Whale', direction: inferWhaleDirection(intel) });
  }

  const known = chips.filter(c => c.direction != null);
  const up = known.filter(c => c.direction === 'UP').length;
  const down = known.filter(c => c.direction === 'DOWN').length;
  const neutral = known.filter(c => c.direction === 'NEUTRAL').length;

  let summary: string;
  if (!known.length) {
    summary = `0/${chips.length} mixed`;
  } else if (consensusDirection && consensusDirection !== 'NEUTRAL') {
    const aligned = known.filter(c => c.direction === consensusDirection).length;
    summary = `${aligned}/${chips.length} ${consensusDirection.toLowerCase()}`;
  } else {
    const parts = [
      up ? `${up}↑` : null,
      down ? `${down}↓` : null,
      neutral ? `${neutral} neutral` : null,
    ].filter(Boolean);
    summary = parts.length ? parts.join(' · ') : `${known.length}/${chips.length} mixed`;
  }

  return { summary, chips };
}

export interface ParsedSynthesis {
  verdict: VerdictCall;
  direction: Direction | null;
  move: string | null;
  confidence: string | null;
  why: string | null;
  /** Screenshot / whale flow intel line from synthesis. */
  whale: string | null;
  /** Legacy single-line TRADE (older saved syntheses). */
  trade: string | null;
  tradePlan: ParsedTradePlan | null;
  raw: string;
}

export type TradeLeg = {
  side: 'BUY' | 'SELL';
  type: 'CALL' | 'PUT';
  strike: number;
};

export type ParsedTradePlan = {
  type: string | null;
  expiry: string | null;
  legs: TradeLeg[];
  limit: string | null;
};

export function parseTradeLegLine(raw: string): TradeLeg | null {
  const cleaned = raw.replace(/^[-—–\s]+/, '').trim();
  if (!cleaned || cleaned === '—' || cleaned === '-') return null;
  const m = cleaned.match(/^(BUY|SELL)\s+(CALL|PUT)\s+\$?([\d.]+)/i);
  if (!m) return null;
  return {
    side: m[1].toUpperCase() as TradeLeg['side'],
    type: m[2].toUpperCase() as TradeLeg['type'],
    strike: parseFloat(m[3]),
  };
}

function parseTradePlan(text: string, line: (key: string) => string | null): ParsedTradePlan | null {
  const typeRaw = line('TRADE TYPE');
  if (!typeRaw) return null;

  const type = typeRaw.trim();
  const none = !type || type === '—' || type === '-' || type.toUpperCase() === 'NONE';
  if (none) {
    return { type: 'NONE', expiry: null, legs: [], limit: null };
  }

  const legs: TradeLeg[] = [];
  for (const m of text.matchAll(/^TRADE LEG \d+:\s*(.+)$/gim)) {
    const leg = parseTradeLegLine(m[1]);
    if (leg) legs.push(leg);
  }

  const expiryRaw = line('TRADE EXPIRY');
  const expiry =
    expiryRaw && expiryRaw !== '—' && expiryRaw !== '-' ? expiryRaw.trim() : null;
  const limitRaw = line('TRADE LIMIT');
  const limit =
    limitRaw && limitRaw !== '—' && limitRaw !== '-' ? limitRaw.trim() : null;

  return { type, expiry, legs, limit };
}

export function formatTradePlanForCopy(plan: ParsedTradePlan | null): string | null {
  if (!plan) return null;
  if (plan.type === 'NONE' || (!plan.legs.length && !plan.limit)) {
    return plan.type === 'NONE' ? 'None — no trade' : null;
  }
  const lines = [plan.type ?? 'Trade'];
  if (plan.expiry) lines.push(`Expiry: ${plan.expiry}`);
  for (const leg of plan.legs) {
    lines.push(`  ${leg.side} ${leg.type} $${leg.strike}`);
  }
  if (plan.limit) lines.push(`Limit: ${plan.limit}`);
  return lines.join('\n');
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
    whale: line('WHALE'),
    trade: line('TRADE'),
    tradePlan: parseTradePlan(text, line),
    raw: text,
  };
}

/** WHALE line from synthesis, else brief OCR summary for display. */
export function resolveVerdictWhale(
  parsed: ParsedSynthesis,
  brief: AiBriefPayload,
): string | null {
  const fromSynth = parsed.whale?.trim();
  if (fromSynth && fromSynth !== '—' && fromSynth !== '-') return fromSynth;
  const ocr = brief.whale_intel?.summary?.trim();
  if (!ocr) return null;
  return ocr.replace(/\n/g, ' · ').slice(0, 280);
}

/** Plain-text block for clipboard from parsed Final Verdict. */
export function formatConsensusForCopy(
  parsed: ParsedSynthesis,
  why: string | null,
  alignSummary: string,
  ticker: string,
  whale?: string | null,
): string {
  const head = [
    `${ticker} — Final Verdict`,
    [parsed.verdict, parsed.direction, parsed.confidence].filter(Boolean).join(' · '),
  ].join('\n');
  const body = [
    parsed.move ? `Move: ${parsed.move}` : null,
    why ? `Why: ${why}` : null,
    whale ? `Whale: ${whale}` : null,
    formatTradePlanForCopy(parsed.tradePlan) ?? (parsed.trade ? `Trade: ${parsed.trade}` : null),
    `Alignment: ${alignSummary}`,
  ].filter(Boolean);
  return [head, '', ...body].join('\n');
}
