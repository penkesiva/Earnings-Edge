/**
 * LLM-based headline classifier — risks + per-headline sentiment + overall bias
 * in a single batch call (shared by overhangDetector.ts).
 *
 * Provider: Gemini 2.5 Flash Lite > OpenAI GPT-4o-mini
 * Cache: llm_scan_cache per (ticker, scan_date)
 */

import type { OverhangCategory } from '@/lib/screamTest';
import {
  GEMINI_FLASH_LITE_MODEL,
  GEMINI_VISION_OCR_MODEL,
  geminiGenerateContentUrl,
} from '@/lib/geminiModels';
import { supabaseAdmin } from '@/lib/supabase';
import type {
  HeadlineSentiment,
  HeadlineSentimentLabel,
  HeadlineRelevance,
  NewsBias,
  NewsOverallSentiment,
} from '@/lib/newsSentiment';
import { emptyNewsOverall } from '@/lib/newsSentiment';

// ── Shared types ──────────────────────────────────────────────────────────────

export type LlmRiskResult = {
  i: number;
  category: OverhangCategory;
  severity: number;
  summary: string;
  resolved: boolean;
};

export type HeadlineInput = {
  i: number;
  date: string;
  title: string;
};

export type LlmClassificationResult = {
  risks: LlmRiskResult[];
  sentiments: HeadlineSentiment[];
  overall: NewsOverallSentiment;
};

// ── Prompt ────────────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are an institutional equity analyst assistant specialising in pre-earnings news analysis.

You receive a chronological list of news headlines (oldest first) for ONE stock ticker before its earnings report.

Perform THREE tasks in one response:

## Task A — Per-headline sentiment
For EVERY headline index in the input list, classify how the headline likely affects the STOCK'S POST-EARNINGS PRICE REACTION (not long-term business quality):
- sentiment: "bullish" | "bearish" | "neutral"
- relevance: "low" | "medium" | "high" (weight for earnings trade)
- note: optional short phrase (max 12 words)

Sentiment rules:
- Downgrades, misses, weak comps/guidance, margin pressure, regulatory probes → bearish
- "Will soar", upgrade, strong outlook, relief-rally thesis, beat expectations → bullish
- Generic market roundups listing many tickers as "top picks" → neutral, relevance low
- Competitor stories that do NOT explicitly threaten THIS company → neutral, relevance low
- Positive partnership/product news for THIS company → bullish unless already priced in (then neutral)

## Task B — Overall news bias
Summarize the full headline set for an earnings trader:
- bias: "bullish" | "bearish" | "mixed" | "neutral"
- bullish / bearish / neutral: counts from Task A
- summary: one sentence (max 30 words) on dominant narrative into earnings

## Task C — Material risks (negative overhangs)
Identify NEGATIVE risk signals (same rules as before). What counts as a risk:
- Competitive threat explicitly against THIS company
- Analyst downgrade or PT cut for THIS company
- Guidance reduction, pre-announcement miss, management warning
- Material customer/contract loss
- Regulatory, legal, or SEC investigation
- Sector repricing specifically hurting this name

EXCLUDE as risks (but may still be bullish/neutral in Task A):
- "Top N stocks to buy" roundups
- Pure buy recommendations and price-target raises
- Competitor news not framed as a threat to THIS company

For each risk, check if a LATER headline resolves it (resolved: true).

Return ONLY valid JSON:
{
  "headlines": [
    { "i": 0, "sentiment": "bearish", "relevance": "high", "note": "optional" }
  ],
  "overall": {
    "bias": "mixed",
    "bullish": 2,
    "bearish": 5,
    "neutral": 8,
    "summary": "one sentence"
  },
  "risks": [
    {
      "i": 0,
      "category": "guidance_concern",
      "severity": 3,
      "summary": "one sentence",
      "resolved": false
    }
  ]
}

You MUST include one entry in "headlines" for every input index 0..N-1.
If no risks, return "risks": [].`;

// ── Helpers ───────────────────────────────────────────────────────────────────

function buildNumberedList(headlines: HeadlineInput[]): string {
  return headlines.map(h => `[${h.i}] (${h.date}) ${h.title}`).join('\n');
}

const VALID_CATS: OverhangCategory[] = [
  'competitive', 'sector_repricing', 'downgrade', 'guidance_concern',
  'customer_loss', 'regulatory', 'macro_specific',
];

const VALID_SENTIMENT: HeadlineSentimentLabel[] = ['bullish', 'bearish', 'neutral'];
const VALID_RELEVANCE: HeadlineRelevance[] = ['low', 'medium', 'high'];
const VALID_BIAS: NewsBias[] = ['bullish', 'bearish', 'mixed', 'neutral'];

function parseClassification(
  json: string,
  headlineCount: number,
): LlmClassificationResult {
  let parsed: {
    headlines?: HeadlineSentiment[];
    overall?: Partial<NewsOverallSentiment>;
    risks?: LlmRiskResult[];
  };
  try {
    parsed = JSON.parse(json) as typeof parsed;
  } catch {
    return { risks: [], sentiments: fillMissingSentiments(headlineCount, []), overall: emptyNewsOverall() };
  }

  const rawSentiments = (parsed.headlines ?? []).filter(
    s =>
      typeof s.i === 'number' &&
      VALID_SENTIMENT.includes(s.sentiment as HeadlineSentimentLabel) &&
      VALID_RELEVANCE.includes(s.relevance as HeadlineRelevance),
  ) as HeadlineSentiment[];

  const risks = (parsed.risks ?? []).filter(
    r =>
      typeof r.i === 'number' &&
      VALID_CATS.includes(r.category as OverhangCategory) &&
      typeof r.severity === 'number' &&
      typeof r.summary === 'string' &&
      typeof r.resolved === 'boolean',
  );

  const o = parsed.overall;
  const overall: NewsOverallSentiment =
    o && VALID_BIAS.includes(o.bias as NewsBias) && typeof o.summary === 'string'
      ? {
          bias: o.bias as NewsBias,
          bullish: typeof o.bullish === 'number' ? o.bullish : 0,
          bearish: typeof o.bearish === 'number' ? o.bearish : 0,
          neutral: typeof o.neutral === 'number' ? o.neutral : 0,
          summary: o.summary.slice(0, 300),
        }
      : emptyNewsOverall();

  return {
    risks,
    sentiments: fillMissingSentiments(headlineCount, rawSentiments),
    overall,
  };
}

function fillMissingSentiments(
  count: number,
  raw: HeadlineSentiment[],
): HeadlineSentiment[] {
  const byI = new Map(raw.map(s => [s.i, s]));
  const out: HeadlineSentiment[] = [];
  for (let i = 0; i < count; i++) {
    const s = byI.get(i);
    out.push(
      s ?? { i, sentiment: 'neutral', relevance: 'low', note: '' },
    );
  }
  return out;
}

async function callLlm(
  provider: 'gemini' | 'openai',
  ticker: string,
  headlines: HeadlineInput[],
): Promise<string> {
  const userMessage =
    `Ticker: ${ticker}\n\nHeadlines (chronological, oldest first):\n${buildNumberedList(headlines)}`;

  if (provider === 'gemini') {
    const key = process.env.GEMINI_API_KEY;
    if (!key) return '{}';
    const res = await fetch(geminiGenerateContentUrl(GEMINI_FLASH_LITE_MODEL, key), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: SYSTEM_PROMPT }] },
        contents: [{ parts: [{ text: userMessage }] }],
        generationConfig: {
          response_mime_type: 'application/json',
          temperature: 0,
          maxOutputTokens: 8192,
        },
      }),
      cache: 'no-store',
    });
    if (!res.ok) return '{}';
    const data = (await res.json()) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    };
    return data.candidates?.[0]?.content?.parts?.[0]?.text ?? '{}';
  }

  const key = process.env.OPENAI_API_KEY;
  if (!key) return '{}';
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
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
      max_tokens: 4096,
      temperature: 0,
    }),
    cache: 'no-store',
  });
  if (!res.ok) return '{}';
  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  return data.choices?.[0]?.message?.content ?? '{}';
}

// ── Supabase cache ────────────────────────────────────────────────────────────

type CacheRow = {
  risks: LlmRiskResult[];
  headline_sentiments: HeadlineSentiment[];
  news_overall: NewsOverallSentiment;
};

async function readCache(ticker: string, scanDate: string): Promise<CacheRow | null> {
  try {
    const db = supabaseAdmin();
    const { data, error } = await db
      .from('llm_scan_cache')
      .select('risks, headline_sentiments, news_overall')
      .eq('ticker', ticker)
      .eq('scan_date', scanDate)
      .maybeSingle();
    if (error || !data) return null;
    const sentiments = data.headline_sentiments as HeadlineSentiment[] | null;
    const overall = data.news_overall as NewsOverallSentiment | null;
    if (!sentiments?.length || !overall?.bias) return null;
    return {
      risks: (data.risks as LlmRiskResult[]) ?? [],
      headline_sentiments: sentiments,
      news_overall: overall,
    };
  } catch {
    return null;
  }
}

async function writeCache(ticker: string, scanDate: string, row: CacheRow): Promise<void> {
  try {
    const db = supabaseAdmin();
    await db.from('llm_scan_cache').upsert(
      {
        ticker,
        scan_date: scanDate,
        risks: row.risks,
        headline_sentiments: row.headline_sentiments,
        news_overall: row.news_overall,
      },
      { onConflict: 'ticker,scan_date' },
    );
  } catch {
    // non-fatal
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Classify all headlines in one LLM call: per-headline sentiment, overall bias,
 * and material risks. Cached per (ticker, scanDate).
 */
export async function classifyHeadlines(
  ticker: string,
  headlines: HeadlineInput[],
  scanDate?: string,
): Promise<LlmClassificationResult> {
  if (headlines.length === 0) {
    return { risks: [], sentiments: [], overall: emptyNewsOverall() };
  }

  if (scanDate) {
    const cached = await readCache(ticker, scanDate);
    if (cached) {
      return {
        risks: cached.risks,
        sentiments: fillMissingSentiments(headlines.length, cached.headline_sentiments),
        overall: cached.news_overall,
      };
    }
  }

  let json = '{}';
  try {
    if (process.env.GEMINI_API_KEY) {
      json = await callLlm('gemini', ticker, headlines);
    } else if (process.env.OPENAI_API_KEY) {
      json = await callLlm('openai', ticker, headlines);
    }
  } catch {
    json = '{}';
  }

  const result = parseClassification(json, headlines.length);

  if (scanDate && (process.env.GEMINI_API_KEY || process.env.OPENAI_API_KEY)) {
    await writeCache(ticker, scanDate, {
      risks: result.risks,
      headline_sentiments: result.sentiments,
      news_overall: result.overall,
    });
  }

  return result;
}

export function hasLlmProvider(): boolean {
  return !!(process.env.GEMINI_API_KEY || process.env.OPENAI_API_KEY);
}

// ── Gemini Search grounding — supplemental news fetch ─────────────────────────

export async function fetchGeminiSearchHeadlines(
  ticker: string,
  scanDate: string,
): Promise<HeadlineInput[]> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) return [];

  const prompt =
    `Search Google News for the most recent news headlines about ${ticker} stock ` +
    `published in the last 30 days before ${scanDate}. ` +
    `Return ONLY valid JSON with no other text:\n` +
    `{ "headlines": [ { "date": "YYYY-MM-DD", "title": "exact headline text" } ] }\n` +
    `Include up to 15 headlines. Estimate the date if exact date is unclear.`;

  try {
    const res = await fetch(geminiGenerateContentUrl(GEMINI_VISION_OCR_MODEL, key), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        tools: [{ google_search: {} }],
        generationConfig: { response_mime_type: 'application/json', temperature: 0 },
      }),
      cache: 'no-store',
    });

    if (!res.ok) return [];

    const data = (await res.json()) as {
      candidates?: Array<{
        content?: { parts?: Array<{ text?: string }> };
        groundingMetadata?: {
          groundingChunks?: Array<{ web?: { uri?: string; title?: string } }>;
        };
      }>;
    };

    const text = data.candidates?.[0]?.content?.parts?.[0]?.text ?? '{}';

    try {
      const parsed = JSON.parse(text) as { headlines?: Array<{ date: string; title: string }> };
      if (Array.isArray(parsed.headlines) && parsed.headlines.length > 0) {
        return parsed.headlines
          .filter(h => h.title?.trim())
          .map((h, i) => ({
            i,
            date: h.date?.slice(0, 10) || scanDate,
            title: h.title.trim(),
          }));
      }
    } catch {
      // fall through
    }

    const chunks = data.candidates?.[0]?.groundingMetadata?.groundingChunks ?? [];
    return chunks
      .filter(c => c.web?.title?.trim())
      .map((c, i) => ({ i, date: scanDate, title: c.web!.title!.trim() }));
  } catch {
    return [];
  }
}
