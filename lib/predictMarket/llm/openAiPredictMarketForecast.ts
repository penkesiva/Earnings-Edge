/**
 * PredictMarket forecast via OpenAI Responses API + hosted web_search.
 * Same OPENAI_API_KEY as the rest of the app; citations stored from response annotations when present.
 */

import { OPENAI_PREDICTMARKET_MODEL } from '@/lib/llmModels';
import type { MarketDataBundle } from '@/lib/predictMarket/providers/types';
import type { PredictionType, PredictDirection, PredictTradeBias } from '@/lib/predictMarket/types';

export type ForecastNewsRow = {
  headline: string;
  classification: 'BULLISH' | 'BEARISH' | 'UNCERTAIN';
  impact: 'LOW' | 'MEDIUM' | 'HIGH';
  mechanism: string;
  source: { name: string; url?: string | null; retrievedAt: string };
};

export type GeneratedForecast = {
  structured: {
    session_date: string;
    prediction_type: PredictionType;
    direction: PredictDirection;
    confidence: number;
    expected_open_direction?: string | null;
    expected_gap_percent?: number | null;
    expected_low?: number | null;
    expected_high?: number | null;
    expected_close?: number | null;
    expected_day_return_percent?: number | null;
    trade_bias: PredictTradeBias;
    bullish_score?: number | null;
    bearish_score?: number | null;
    top_bullish_factors: string[];
    top_bearish_factors: string[];
    key_levels: Record<string, number | null>;
    invalidation_conditions: string[];
  };
  reasoning: string;
  news: ForecastNewsRow[];
  rawResponseExcerpt: string;
};

const SYSTEM = `You are PredictMarket — an SPX session research engine for the next U.S. cash equity session.

Rules:
- Use web search for fresh macro/news/calendar only when needed; cite real sources.
- NEVER invent live prices. Use MARKET_DATA for numbers; null if missing.
- Technical levels in key_levels must come from MARKET_DATA.technical or be null.
- Output exactly one JSON object inside a fenced \`\`\`json block, then a short REASONING section.
- direction: GREEN | RED | NEUTRAL. trade_bias: CALL | PUT | NO_TRADE.
- confidence 0-100. NEUTRAL when edge is weak.

JSON schema keys:
session_date, prediction_type, direction, confidence,
expected_open_direction, expected_gap_percent,
expected_low, expected_high, expected_close, expected_day_return_percent,
trade_bias, bullish_score, bearish_score,
top_bullish_factors, top_bearish_factors, key_levels, invalidation_conditions,
news_events (array of {headline, classification, impact, mechanism, source_name, source_url})`;

export async function generatePredictMarketForecast(input: {
  predictionType: PredictionType;
  sessionDate: string;
  asOfPt: string;
  market: MarketDataBundle;
  historicalStats: string;
}): Promise<GeneratedForecast> {
  const key = process.env.OPENAI_API_KEY?.trim();
  if (!key) throw new Error('OPENAI_API_KEY not configured');

  const userPrompt = [
    `prediction_type: ${input.predictionType}`,
    `session_date (target NYSE session): ${input.sessionDate}`,
    `as_of Pacific: ${input.asOfPt}`,
    '',
    '## MARKET_DATA (ACTUAL/CALCULATED — do not override with search)',
    JSON.stringify(input.market, null, 2),
    '',
    '## HISTORICAL_STATS (CALCULATED — interpret only, do not recalculate)',
    input.historicalStats || 'No graded history yet.',
    '',
    'Research catalysts for this session. Produce JSON + REASONING.',
  ].join('\n');

  const res = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: OPENAI_PREDICTMARKET_MODEL,
      tools: [{ type: 'web_search' }],
      input: [
        { role: 'system', content: SYSTEM },
        { role: 'user', content: userPrompt },
      ],
    }),
    cache: 'no-store',
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`OpenAI Responses API ${res.status}: ${err.slice(0, 400)}`);
  }

  const json = (await res.json()) as Record<string, unknown>;
  const text = extractResponseText(json);
  if (!text.trim()) throw new Error('Empty PredictMarket LLM response');

  const parsed = parseForecastJson(text, input.sessionDate, input.predictionType);
  const news = parseNewsFromJson(text, input.asOfPt);
  const reasoning = extractReasoning(text);

  return {
    structured: parsed,
    reasoning,
    news,
    rawResponseExcerpt: text.slice(0, 4000),
  };
}

function extractResponseText(body: Record<string, unknown>): string {
  if (typeof body.output_text === 'string') return body.output_text;

  const output = body.output;
  if (!Array.isArray(output)) return '';

  const chunks: string[] = [];
  for (const item of output) {
    if (!item || typeof item !== 'object') continue;
    const row = item as Record<string, unknown>;
    if (row.type === 'message' && Array.isArray(row.content)) {
      for (const c of row.content) {
        if (c && typeof c === 'object') {
          const part = c as Record<string, unknown>;
          if (part.type === 'output_text' && typeof part.text === 'string') {
            chunks.push(part.text);
          }
        }
      }
    }
  }
  return chunks.join('\n');
}

function parseForecastJson(
  text: string,
  sessionDate: string,
  predictionType: PredictionType,
): GeneratedForecast['structured'] {
  const fence = text.match(/```json\s*([\s\S]*?)```/i);
  const raw = fence?.[1]?.trim() ?? text.trim();
  let obj: Record<string, unknown>;
  try {
    obj = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    const start = raw.indexOf('{');
    const end = raw.lastIndexOf('}');
    if (start < 0 || end <= start) throw new Error('Could not parse forecast JSON');
    obj = JSON.parse(raw.slice(start, end + 1)) as Record<string, unknown>;
  }

  const direction = normalizeDirection(String(obj.direction ?? 'NEUTRAL'));
  const tradeBias = normalizeTradeBias(String(obj.trade_bias ?? 'NO_TRADE'));

  return {
    session_date: String(obj.session_date ?? sessionDate),
    prediction_type: predictionType,
    direction,
    confidence: clampConfidence(obj.confidence),
    expected_open_direction: strOrNull(obj.expected_open_direction),
    expected_gap_percent: numOrNull(obj.expected_gap_percent),
    expected_low: numOrNull(obj.expected_low),
    expected_high: numOrNull(obj.expected_high),
    expected_close: numOrNull(obj.expected_close),
    expected_day_return_percent: numOrNull(obj.expected_day_return_percent),
    trade_bias: tradeBias,
    bullish_score: numOrNull(obj.bullish_score),
    bearish_score: numOrNull(obj.bearish_score),
    top_bullish_factors: stringArray(obj.top_bullish_factors),
    top_bearish_factors: stringArray(obj.top_bearish_factors),
    key_levels: keyLevels(obj.key_levels),
    invalidation_conditions: stringArray(obj.invalidation_conditions),
  };
}

function parseNewsFromJson(text: string, retrievedAt: string): ForecastNewsRow[] {
  const fence = text.match(/```json\s*([\s\S]*?)```/i);
  if (!fence) return [];
  try {
    const obj = JSON.parse(fence[1]) as Record<string, unknown>;
    const rows = obj.news_events;
    if (!Array.isArray(rows)) return [];
    return rows
      .map(row => {
        if (!row || typeof row !== 'object') return null;
        const r = row as Record<string, unknown>;
        const headline = String(r.headline ?? '').trim();
        if (!headline) return null;
        return {
          headline,
          classification: normalizeNewsClass(String(r.classification ?? 'UNCERTAIN')),
          impact: normalizeImpact(String(r.impact ?? 'LOW')),
          mechanism: String(r.mechanism ?? '').slice(0, 500),
          source: {
            name: String(r.source_name ?? 'web'),
            url: strOrNull(r.source_url),
            retrievedAt,
          },
        } satisfies ForecastNewsRow;
      })
      .filter(Boolean) as ForecastNewsRow[];
  } catch {
    return [];
  }
}

function extractReasoning(text: string): string {
  const m = text.match(/REASONING:\s*([\s\S]+)$/i);
  if (m?.[1]) return m[1].trim().slice(0, 8000);
  const afterFence = text.split(/```/)[2];
  return afterFence?.trim().slice(0, 8000) ?? text.slice(0, 2000);
}

function normalizeDirection(v: string): PredictDirection {
  if (v.includes('GREEN')) return 'GREEN';
  if (v.includes('RED')) return 'RED';
  return 'NEUTRAL';
}

function normalizeTradeBias(v: string): PredictTradeBias {
  if (v.includes('CALL')) return 'CALL';
  if (v.includes('PUT')) return 'PUT';
  return 'NO_TRADE';
}

function normalizeNewsClass(v: string): ForecastNewsRow['classification'] {
  if (v.includes('BULL')) return 'BULLISH';
  if (v.includes('BEAR')) return 'BEARISH';
  return 'UNCERTAIN';
}

function normalizeImpact(v: string): ForecastNewsRow['impact'] {
  if (v.includes('HIGH')) return 'HIGH';
  if (v.includes('MEDIUM')) return 'MEDIUM';
  return 'LOW';
}

function clampConfidence(v: unknown): number {
  const n = Number(v);
  if (!Number.isFinite(n)) return 50;
  return Math.min(100, Math.max(0, Math.round(n)));
}

function numOrNull(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function strOrNull(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s || null;
}

function stringArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.map(x => String(x).trim()).filter(Boolean).slice(0, 12);
}

function keyLevels(v: unknown): Record<string, number | null> {
  if (!v || typeof v !== 'object') return {};
  const out: Record<string, number | null> = {};
  for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
    out[k] = numOrNull(val);
  }
  return out;
}
