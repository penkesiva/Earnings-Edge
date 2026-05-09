/**
 * Narrative overhang detector — LLM-based sentiment analysis (primary) with
 * regex keyword matching as a fallback when OPENAI_API_KEY is not set.
 *
 * Primary path (LLM):
 *   Sends all headlines for the ticker in a single gpt-4o-mini call with
 *   JSON-structured output. The model classifies each headline as a risk or
 *   not, assigns a severity (1–5), picks a category, and determines whether
 *   a later headline in the window resolves it. This eliminates false
 *   positives like "Billionaire bets big on growth stocks" being tagged as
 *   a competitive risk via keyword mismatch.
 *
 * Fallback path (regex):
 *   Used when OPENAI_API_KEY is absent or the LLM call fails. Identical to
 *   the previous keyword-bucket approach — less accurate but always available.
 *
 * Price-action path (always active):
 *   Large single-day drops (≥ 8%) with no matched news are always added as
 *   macro_specific overhangs regardless of the headline classification path.
 */

import { getHistoricalBars } from '@/lib/alpaca';
import type { NarrativeOverhang, OverhangCategory } from '@/lib/screamTest';
import { addCalendarDays, earningsSessionDate } from '@/lib/earningsDate';

const STABLE = 'https://financialmodelingprep.com/stable';

type FmpNewsRow = {
  symbol?: string;
  publishedDate?: string;
  date?: string;
  title?: string;
  text?: string;
  url?: string;
  site?: string;
};

type AlpacaBar = { t: string; o: number; h: number; l: number; c: number; v: number };

// ── LLM classifier ────────────────────────────────────────────────────────────

const OPENAI_CHAT_URL = 'https://api.openai.com/v1/chat/completions';

const LLM_SYSTEM_PROMPT = `You are an institutional equity analyst assistant specialising in pre-earnings risk assessment.

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

type LlmRiskResult = {
  i: number;
  category: OverhangCategory;
  severity: number;
  summary: string;
  resolved: boolean;
};

async function classifyHeadlinesWithLlm(
  ticker: string,
  headlines: Array<{ i: number; date: string; title: string }>,
): Promise<LlmRiskResult[]> {
  const key = process.env.OPENAI_API_KEY;
  if (!key || headlines.length === 0) return [];

  // Format headlines as a numbered list with dates so the model has time context
  // for resolution detection.
  const numbered = headlines
    .map(h => `[${h.i}] (${h.date}) ${h.title}`)
    .join('\n');

  let res: Response;
  try {
    res = await fetch(OPENAI_CHAT_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: LLM_SYSTEM_PROMPT },
          {
            role: 'user',
            content: `Ticker: ${ticker}\n\nHeadlines (chronological, oldest first):\n${numbered}`,
          },
        ],
        max_tokens: 2048,
        temperature: 0,
      }),
      // Never cache: we need fresh classifications each scan.
      cache: 'no-store',
    });
  } catch {
    // Network error — fall back to regex silently.
    return [];
  }

  if (!res.ok) return [];

  try {
    const data = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const content = data.choices?.[0]?.message?.content ?? '{}';
    const parsed = JSON.parse(content) as { risks?: LlmRiskResult[] };

    const valid: LlmRiskResult[] = [];
    for (const r of parsed.risks ?? []) {
      // Validate category is a known OverhangCategory value.
      const VALID_CATS: OverhangCategory[] = [
        'competitive', 'sector_repricing', 'downgrade', 'guidance_concern',
        'customer_loss', 'regulatory', 'macro_specific',
      ];
      if (
        typeof r.i === 'number' &&
        VALID_CATS.includes(r.category as OverhangCategory) &&
        typeof r.severity === 'number' &&
        typeof r.summary === 'string' &&
        typeof r.resolved === 'boolean'
      ) {
        valid.push(r);
      }
    }
    return valid;
  } catch {
    return [];
  }
}

// ── Regex fallback (original keyword-bucket approach) ─────────────────────────

const OVERHANG_PATTERNS: Array<{
  category: OverhangCategory;
  patterns: RegExp[];
}> = [
  {
    category: 'competitive',
    patterns: [
      /launch(?:es|ed)?\s+(?:competing|rival|alternative)/i,
      /(?:disrupt|threaten|displace|commoditize)/i,
      /(?:new entrant|emerging competitor|displacement)/i,
      /(?:eats?|eating)\s+\w+'s\s+lunch/i,
      /SaaS-?pocalypse/i,
      /managed agents?/i,
    ],
  },
  {
    category: 'sector_repricing',
    patterns: [
      /sector(?:-wide)?\s+(?:selloff|repric)/i,
      /software\s+(?:rout|crash|selloff)/i,
      /seat compression/i,
      /broad-based\s+(?:decline|selloff)/i,
    ],
  },
  {
    category: 'downgrade',
    patterns: [
      /downgrad(?:e|ed|es)/i,
      /cut(?:s)?\s+(?:price\s+target|rating)/i,
      /lower(?:s|ed)?\s+(?:to\s+)?(?:hold|sell|underperform)/i,
    ],
  },
  {
    category: 'guidance_concern',
    patterns: [
      /(?:lower(?:s|ed)?|cuts?)\s+(?:full[- ]year\s+)?guidance/i,
      /pre[- ]announce(?:s|ment)\s+(?:miss|disappointing)/i,
      /warns?\s+of\s+(?:weak|soft|disappointing)/i,
    ],
  },
  {
    category: 'customer_loss',
    patterns: [
      /(?:loses?|lost)\s+(?:major|key|anchor)\s+(?:customer|contract|client)/i,
      /contract\s+(?:cancel|terminat)/i,
    ],
  },
  {
    category: 'regulatory',
    patterns: [
      /SEC\s+(?:probe|investigation|inquiry)/i,
      /(?:DOJ|FTC|antitrust)\s+(?:probe|investigation)/i,
      /class[- ]action\s+lawsuit/i,
    ],
  },
];

const RESOLUTION_PATTERNS = [
  /reaffirm(?:s|ed)?\s+guidance/i,
  /raise(?:s|d)?\s+(?:full[- ]year\s+)?guidance/i,
  /beat(?:s)?\s+expectations/i,
  /addresses?\s+(?:competitive\s+)?concerns?/i,
  /not\s+(?:a\s+)?threat/i,
  /complementary\s+(?:not\s+)?(?:competitive|displacement)/i,
];

function classifyHeadlineRegex(title: string, text: string): OverhangCategory | null {
  const corpus = `${title}\n${text}`;
  for (const { category, patterns } of OVERHANG_PATTERNS) {
    if (patterns.some(p => p.test(corpus))) return category;
  }
  return null;
}

function detectResolutionRegex(overhangDate: string, laterNews: FmpNewsRow[]): boolean {
  const overhangTime = new Date(overhangDate).getTime();
  const cutoff = overhangTime + 14 * 24 * 60 * 60 * 1000;
  for (const item of laterNews) {
    const pd = newsPublishedDate(item);
    const itemTime = new Date(pd).getTime();
    if (itemTime <= overhangTime || itemTime > cutoff) continue;
    const corpus = `${item.title ?? ''}\n${item.text ?? ''}`;
    if (RESOLUTION_PATTERNS.some(p => p.test(corpus))) return true;
  }
  return false;
}

// ── Shared utilities ──────────────────────────────────────────────────────────

function newsPublishedDate(row: FmpNewsRow): string {
  const d = row.publishedDate || row.date || '';
  return String(d).slice(0, 10);
}

function findBigDrawdowns(
  bars: AlpacaBar[],
  thresholdPct = 5,
): Array<{ date: string; drawdownPct: number }> {
  const result: Array<{ date: string; drawdownPct: number }> = [];
  for (let i = 1; i < bars.length; i++) {
    const prev = bars[i - 1].c;
    const curr = bars[i].c;
    if (!prev || prev <= 0) continue;
    const dropPct = ((prev - curr) / prev) * 100;
    if (dropPct >= thresholdPct) {
      const rawT = bars[i].t;
      const dateStr = typeof rawT === 'string' ? rawT.slice(0, 10) : String(rawT).slice(0, 10);
      result.push({ date: dateStr, drawdownPct: Math.round(dropPct * 10) / 10 });
    }
  }
  return result;
}

async function fetchStableStockNews(ticker: string): Promise<FmpNewsRow[]> {
  const key = process.env.FMP_API_KEY;
  if (!key) return [];
  const url = `${STABLE}/news/stock?symbols=${encodeURIComponent(ticker)}&page=0&limit=100&apikey=${encodeURIComponent(key)}`;
  const res = await fetch(url, { next: { revalidate: 900 } });
  if (!res.ok) return [];
  const data = (await res.json()) as unknown;
  return Array.isArray(data) ? (data as FmpNewsRow[]) : [];
}

// ── Main entry point ──────────────────────────────────────────────────────────

/**
 * Returns narrative overhang rows for `computeScreamTest` (may be empty).
 *
 * Uses LLM classification when OPENAI_API_KEY is set; otherwise falls back to
 * regex keyword matching. Price-action large-drop detection is always active.
 *
 * @param asOfDate - YYYY-MM-DD end of bar window (defaults to US session today).
 */
export async function detectOverhangs(opts: {
  ticker: string;
  daysBack?: number;
  asOfDate?: string;
}): Promise<NarrativeOverhang[]> {
  const daysBack = opts.daysBack ?? 60;
  const ticker = opts.ticker.toUpperCase();

  try {
    const end = opts.asOfDate ?? earningsSessionDate();
    const start = addCalendarDays(end, -daysBack);

    const [news, bars] = await Promise.all([
      fetchStableStockNews(ticker),
      getHistoricalBars(ticker, start, end, '1Day'),
    ]);

    const filteredNews = news
      .filter(n => newsPublishedDate(n) >= start)
      // Sort oldest-first so the LLM can follow resolution logic chronologically.
      .sort((a, b) => newsPublishedDate(a).localeCompare(newsPublishedDate(b)));

    const drawdowns = findBigDrawdowns((bars || []) as AlpacaBar[], 5);
    const overhangs: NarrativeOverhang[] = [];
    const seen = new Set<string>();

    const useLlm = !!process.env.OPENAI_API_KEY;

    if (useLlm) {
      // ── LLM path ────────────────────────────────────────────────────────────
      const headlines = filteredNews.map((n, i) => ({
        i,
        date: newsPublishedDate(n),
        title: n.title ?? '',
      }));

      const llmResults = await classifyHeadlinesWithLlm(ticker, headlines);

      for (const r of llmResults) {
        // Skip very minor mentions (severity 1 = noise).
        if (r.severity < 2) continue;

        const item = filteredNews[r.i];
        if (!item) continue;

        const dateKey = newsPublishedDate(item);
        const dedupeKey = `${r.category}:${dateKey}`;
        if (seen.has(dedupeKey)) continue;
        seen.add(dedupeKey);

        const matchedDrawdown = drawdowns.find(d => {
          const diffDays =
            Math.abs(new Date(d.date).getTime() - new Date(dateKey).getTime()) /
            (24 * 60 * 60 * 1000);
          return diffDays <= 2;
        });

        overhangs.push({
          category: r.category,
          description: r.summary.length > 200 ? r.summary.slice(0, 197) + '...' : r.summary,
          detectedDate: dateKey,
          drawdownPct: matchedDrawdown?.drawdownPct ?? null,
          resolved: r.resolved,
          source: item.url || item.site || 'llm',
        });
      }
    } else {
      // ── Regex fallback path ────────────────────────────────────────────────
      for (const item of filteredNews) {
        const title = item.title ?? '';
        const text = item.text ?? '';
        const category = classifyHeadlineRegex(title, text);
        if (!category) continue;

        const dateKey = newsPublishedDate(item);
        const dedupeKey = `${category}:${dateKey}`;
        if (seen.has(dedupeKey)) continue;
        seen.add(dedupeKey);

        const matchedDrawdown = drawdowns.find(d => {
          const diffDays =
            Math.abs(new Date(d.date).getTime() - new Date(dateKey).getTime()) /
            (24 * 60 * 60 * 1000);
          return diffDays <= 2;
        });

        const laterNews = filteredNews.filter(n => newsPublishedDate(n) > dateKey);
        const title200 = title.length > 200 ? title.slice(0, 197) + '...' : title;

        overhangs.push({
          category,
          description: title200,
          detectedDate: dateKey,
          drawdownPct: matchedDrawdown?.drawdownPct ?? null,
          resolved: detectResolutionRegex(dateKey, laterNews),
          source: item.url || item.site || 'news',
        });
      }
    }

    // ── Price-action path (always active) ─────────────────────────────────────
    // Large drops (≥ 8%) with no associated headline get added regardless of
    // which classification path was used above.
    for (const d of drawdowns) {
      if (d.drawdownPct < 8) continue;
      const alreadyCovered = overhangs.some(o => {
        const diffDays =
          Math.abs(new Date(o.detectedDate).getTime() - new Date(d.date).getTime()) /
          (24 * 60 * 60 * 1000);
        return diffDays <= 2;
      });
      if (alreadyCovered) continue;
      overhangs.push({
        category: 'macro_specific',
        description: `Unexplained ${d.drawdownPct}% single-day drop`,
        detectedDate: d.date,
        drawdownPct: d.drawdownPct,
        resolved: false,
        source: 'price_action',
      });
    }

    // Return newest-first (matches original ordering).
    overhangs.sort((a, b) => (a.detectedDate < b.detectedDate ? 1 : -1));
    return overhangs;
  } catch {
    return [];
  }
}
