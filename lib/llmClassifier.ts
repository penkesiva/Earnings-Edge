/**
 * LLM-based headline risk classifier — shared by overhangDetector.ts.
 *
 * Provider selection (first available key wins):
 *   1. GEMINI_API_KEY  → Google Gemini 2.0 Flash
 *   2. OPENAI_API_KEY  → OpenAI GPT-4o-mini
 *   3. Neither set     → returns [] (caller falls back to regex)
 *
 * Both providers use the same structured JSON output schema and the same
 * system prompt so results are equivalent regardless of which key is active.
 *
 * Cache: when `scanDate` (YYYY-MM-DD) is supplied, results are persisted to
 * the `llm_scan_cache` Supabase table. Subsequent calls for the same
 * (ticker, scanDate) pair skip the LLM entirely and return the stored risks.
 * This means multiple rescans of the same ticker on the same day cost one
 * LLM call instead of N.
 */

import type { OverhangCategory } from '@/lib/screamTest';
import { supabaseAdmin } from '@/lib/supabase';

// ── Shared types ──────────────────────────────────────────────────────────────

export type LlmRiskResult = {
  /** 0-based index into the input headlines array. */
  i: number;
  category: OverhangCategory;
  /** 1 = minor mention, 3 = notable, 5 = material / actionable. */
  severity: number;
  /** One-sentence description of the specific risk. */
  summary: string;
  /** True if a LATER headline in the same window resolves this risk. */
  resolved: boolean;
};

export type HeadlineInput = {
  i: number;
  date: string;
  title: string;
};

// ── Shared prompt ─────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are an institutional equity analyst assistant specialising in pre-earnings risk assessment.

Your task: given a chronological list of news headlines for a specific stock ticker, identify NEGATIVE risk signals that could weigh on the stock price or increase uncertainty into its earnings report.

What counts as a risk:
- Competitive threat: a new entrant, a rival product launch framed as a displacement risk, or an article explicitly noting competitive pressure on this company
- Analyst downgrade or price-target cut
- Guidance reduction, pre-announcement of a miss, or management warning of weakness
- Material customer or contract loss
- Regulatory, legal, or SEC investigation
- Sector-wide repricing, broad-based selloff commentary specific to the company's sector

What does NOT count as a risk (common false positives to exclude):
- Positive investor or analyst coverage ("Billionaire bets on X", "Why X is a top pick")
- Partnership or customer win announcements
- General market or macro commentary not specifically about this company's risk
- Product launch news framed positively (unless framing is explicitly competitive/displacement)
- Upgrade, buy recommendation, or price-target raise

For each risk you identify, also check whether any LATER headline in the same list resolves or neutralises that specific risk (e.g. reaffirmed guidance, issue addressed by management, regulatory clearance, partner publicly denies threat).

Return ONLY valid JSON matching this schema — no extra text:
{
  "risks": [
    {
      "i": <int>,            // 0-based index of the risk headline in the input list
      "category": "<competitive|sector_repricing|downgrade|guidance_concern|customer_loss|regulatory|macro_specific>",
      "severity": <1-5>,     // 1=minor mention, 3=notable, 5=material/actionable
      "summary": "<one sentence describing the specific risk>",
      "resolved": <bool>     // true if a LATER headline in the list addresses this risk
    }
  ]
}

If there are no risks, return { "risks": [] }.`;

// ── Helpers ───────────────────────────────────────────────────────────────────

function buildNumberedList(headlines: HeadlineInput[]): string {
  return headlines.map(h => `[${h.i}] (${h.date}) ${h.title}`).join('\n');
}

const VALID_CATS: OverhangCategory[] = [
  'competitive', 'sector_repricing', 'downgrade', 'guidance_concern',
  'customer_loss', 'regulatory', 'macro_specific',
];

function parseRisks(json: string): LlmRiskResult[] {
  try {
    const parsed = JSON.parse(json) as { risks?: LlmRiskResult[] };
    return (parsed.risks ?? []).filter(
      r =>
        typeof r.i === 'number' &&
        VALID_CATS.includes(r.category as OverhangCategory) &&
        typeof r.severity === 'number' &&
        typeof r.summary === 'string' &&
        typeof r.resolved === 'boolean',
    );
  } catch {
    return [];
  }
}

// ── Provider: Gemini ──────────────────────────────────────────────────────────

async function classifyWithGemini(
  ticker: string,
  headlines: HeadlineInput[],
): Promise<LlmRiskResult[]> {
  const key = process.env.GEMINI_API_KEY;
  if (!key || headlines.length === 0) return [];

  const userMessage =
    `Ticker: ${ticker}\n\nHeadlines (chronological, oldest first):\n${buildNumberedList(headlines)}`;

  let res: Response;
  try {
    res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${key}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          system_instruction: { parts: [{ text: SYSTEM_PROMPT }] },
          contents: [{ parts: [{ text: userMessage }] }],
          generationConfig: {
            response_mime_type: 'application/json',
            temperature: 0,
          },
        }),
        cache: 'no-store',
      },
    );
  } catch {
    return [];
  }

  if (!res.ok) return [];

  try {
    const data = (await res.json()) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    };
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text ?? '{}';
    return parseRisks(text);
  } catch {
    return [];
  }
}

// ── Provider: OpenAI ──────────────────────────────────────────────────────────

async function classifyWithOpenAi(
  ticker: string,
  headlines: HeadlineInput[],
): Promise<LlmRiskResult[]> {
  const key = process.env.OPENAI_API_KEY;
  if (!key || headlines.length === 0) return [];

  const userMessage =
    `Ticker: ${ticker}\n\nHeadlines (chronological, oldest first):\n${buildNumberedList(headlines)}`;

  let res: Response;
  try {
    res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: userMessage },
        ],
        max_tokens: 2048,
        temperature: 0,
      }),
      cache: 'no-store',
    });
  } catch {
    return [];
  }

  if (!res.ok) return [];

  try {
    const data = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const text = data.choices?.[0]?.message?.content ?? '{}';
    return parseRisks(text);
  } catch {
    return [];
  }
}

// ── Supabase cache helpers ─────────────────────────────────────────────────────

async function readCache(
  ticker: string,
  scanDate: string,
): Promise<LlmRiskResult[] | null> {
  try {
    const db = supabaseAdmin();
    const { data, error } = await db
      .from('llm_scan_cache')
      .select('risks')
      .eq('ticker', ticker)
      .eq('scan_date', scanDate)
      .maybeSingle();
    if (error || !data) return null;
    return data.risks as LlmRiskResult[];
  } catch {
    return null;
  }
}

async function writeCache(
  ticker: string,
  scanDate: string,
  risks: LlmRiskResult[],
): Promise<void> {
  try {
    const db = supabaseAdmin();
    await db
      .from('llm_scan_cache')
      .upsert({ ticker, scan_date: scanDate, risks }, { onConflict: 'ticker,scan_date' });
  } catch {
    // Cache write failure is non-fatal — next call will just re-classify.
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Classify a list of news headlines for risk signals using the best available
 * LLM provider. Returns [] if no provider key is configured.
 *
 * Provider priority: Gemini > OpenAI
 *
 * @param ticker    - Stock ticker (used for LLM context and cache key).
 * @param headlines - Headlines to classify.
 * @param scanDate  - YYYY-MM-DD. When provided, results are read from / written
 *                    to `llm_scan_cache`. Multiple rescans on the same day share
 *                    one LLM call.
 */
export async function classifyHeadlines(
  ticker: string,
  headlines: HeadlineInput[],
  scanDate?: string,
): Promise<LlmRiskResult[]> {
  if (headlines.length === 0) return [];

  // ── Cache read ──────────────────────────────────────────────────────────────
  if (scanDate) {
    const cached = await readCache(ticker, scanDate);
    if (cached !== null) {
      return cached;
    }
  }

  // ── LLM call ────────────────────────────────────────────────────────────────
  let results: LlmRiskResult[] = [];

  if (process.env.GEMINI_API_KEY) {
    results = await classifyWithGemini(ticker, headlines);
    // Always proceed — empty array means "no risks found", which is valid.
  } else if (process.env.OPENAI_API_KEY) {
    results = await classifyWithOpenAi(ticker, headlines);
  }

  // ── Cache write ─────────────────────────────────────────────────────────────
  if (scanDate) {
    await writeCache(ticker, scanDate, results);
  }

  return results;
}

/** True when at least one LLM provider key is configured. */
export function hasLlmProvider(): boolean {
  return !!(process.env.GEMINI_API_KEY || process.env.OPENAI_API_KEY);
}
