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
import { classifyHeadlines, hasLlmProvider } from '@/lib/llmClassifier';

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

// LLM classification is handled by lib/llmClassifier.ts (Gemini + OpenAI).

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

    if (hasLlmProvider()) {
      // ── LLM path (Gemini > OpenAI) ───────────────────────────────────────────
      const headlines = filteredNews.map((n, i) => ({
        i,
        date: newsPublishedDate(n),
        title: n.title ?? '',
      }));

      // Pass `end` as the cache date — same ticker rescanned on the same day
      // will return the cached result without a new LLM call.
      const llmResults = await classifyHeadlines(ticker, headlines, end);

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
