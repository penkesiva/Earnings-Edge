/**
 * Narrative overhang detector — LLM-based sentiment analysis (primary) with
 * regex keyword matching as a fallback when no LLM key is configured.
 *
 * Primary path (LLM):
 *   1. FMP — up to 100 recent news articles (15-min cache).
 *   2. Gemini Search grounding — up to 15 supplemental headlines from
 *      Google News (catches articles not yet in FMP). Requires GEMINI_API_KEY.
 *   Both sources are de-duplicated by title, merged into one sorted list, and
 *   sent to the LLM classifier in a single call. Severity (1–5) is persisted
 *   on each NarrativeOverhang.
 *
 * Fallback path (regex):
 *   Used when neither LLM key is set. Keyword-bucket approach — less accurate
 *   but always available.
 *
 * Price-action path (always active):
 *   Large single-day drops (≥ 8%) with no associated headline are added as
 *   macro_specific overhangs with auto-assigned severity based on drop size.
 */

import { getHistoricalBars } from '@/lib/alpaca';
import type { NarrativeOverhang, OverhangCategory } from '@/lib/screamTest';
import { addCalendarDays, earningsSessionDate } from '@/lib/earningsDate';
import { classifyHeadlines, fetchGeminiSearchHeadlines, hasLlmProvider } from '@/lib/llmClassifier';
import {
  mergeSentimentsIntoHeadlines,
  type NewsOverallSentiment,
  type RawHeadline,
} from '@/lib/newsSentiment';

export type { RawHeadline } from '@/lib/newsSentiment';

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

/** Auto-assign severity to a price-action drop based on magnitude. */
function dropSeverity(pct: number): number {
  if (pct >= 20) return 5;
  if (pct >= 15) return 4;
  if (pct >= 10) return 3;
  return 2; // 8–10%
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

/** Normalize a title for deduplication (case-insensitive, first 60 chars). */
function normalizeTitle(t: string): string {
  return t.toLowerCase().replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, ' ').trim().slice(0, 60);
}

// ── Main entry point ──────────────────────────────────────────────────────────

export type OverhangResult = {
  overhangs: NarrativeOverhang[];
  /** Deduplicated, oldest-first headline list (FMP + Gemini search) with sentiment tags. */
  rawHeadlines: RawHeadline[];
  /** LLM overall news bias (null when regex fallback or no provider). */
  newsOverall: NewsOverallSentiment | null;
};

/**
 * Returns narrative overhangs and the raw headline list for `computeScreamTest`.
 *
 * Sources: FMP news headlines + Gemini Search grounding (if GEMINI_API_KEY set)
 * + Alpaca price-action large-drop detection.
 *
 * @param asOfDate - YYYY-MM-DD end of bar window (defaults to US session today).
 */
export async function detectOverhangs(opts: {
  ticker: string;
  daysBack?: number;
  asOfDate?: string;
}): Promise<OverhangResult> {
  const daysBack = opts.daysBack ?? 60;
  const ticker = opts.ticker.toUpperCase();

  try {
    const end = opts.asOfDate ?? earningsSessionDate();
    const start = addCalendarDays(end, -daysBack);

    // Fetch FMP news, Alpaca bars, and Gemini search headlines in parallel.
    const [fmpNews, bars, geminiRaw] = await Promise.all([
      fetchStableStockNews(ticker),
      getHistoricalBars(ticker, start, end, '1Day'),
      fetchGeminiSearchHeadlines(ticker, end),
    ]);

    // Filter FMP to the time window and sort oldest-first.
    const filteredFmp = fmpNews
      .filter(n => newsPublishedDate(n) >= start)
      .sort((a, b) => newsPublishedDate(a).localeCompare(newsPublishedDate(b)));

    // Build a combined, deduplicated article list.
    // FMP items come first (richer metadata); Gemini supplements only.
    type MergedArticle = { date: string; title: string; url: string; site: string };
    const seenTitles = new Set<string>();
    const allArticles: MergedArticle[] = [];

    for (const n of filteredFmp) {
      const title = n.title ?? '';
      const norm = normalizeTitle(title);
      if (!norm || seenTitles.has(norm)) continue;
      seenTitles.add(norm);
      allArticles.push({ date: newsPublishedDate(n), title, url: n.url ?? '', site: n.site ?? '' });
    }
    for (const h of geminiRaw) {
      const norm = normalizeTitle(h.title);
      if (!norm || seenTitles.has(norm)) continue;
      seenTitles.add(norm);
      allArticles.push({ date: h.date, title: h.title, url: '', site: 'gemini-search' });
    }
    // Ensure oldest-first for LLM context.
    allArticles.sort((a, b) => a.date.localeCompare(b.date));

    const drawdowns = findBigDrawdowns((bars || []) as AlpacaBar[], 5);
    const overhangs: NarrativeOverhang[] = [];
    const seenOverhang = new Set<string>();

    let llmClassification: Awaited<ReturnType<typeof classifyHeadlines>> | null = null;

    if (hasLlmProvider()) {
      // ── LLM path — one call: risks + per-headline sentiment + overall bias ──
      const headlines = allArticles.map((a, i) => ({ i, date: a.date, title: a.title }));
      llmClassification = await classifyHeadlines(ticker, headlines, end);

      for (const r of llmClassification.risks) {
        if (r.severity < 2) continue; // severity 1 = noise

        const article = allArticles[r.i];
        if (!article) continue;

        const dedupeKey = `${r.category}:${article.date}`;
        if (seenOverhang.has(dedupeKey)) continue;
        seenOverhang.add(dedupeKey);

        const matchedDrawdown = drawdowns.find(d => {
          const diffDays =
            Math.abs(new Date(d.date).getTime() - new Date(article.date).getTime()) /
            (24 * 60 * 60 * 1000);
          return diffDays <= 2;
        });

        overhangs.push({
          category: r.category,
          severity: r.severity,
          description: r.summary.length > 200 ? r.summary.slice(0, 197) + '...' : r.summary,
          detectedDate: article.date,
          drawdownPct: matchedDrawdown?.drawdownPct ?? null,
          resolved: r.resolved,
          source: article.url || article.site || 'llm',
        });
      }
    } else {
      // ── Regex fallback path ────────────────────────────────────────────────
      for (const article of allArticles) {
        // Regex only has access to title; text not available for Gemini-sourced items.
        const category = classifyHeadlineRegex(article.title, '');
        if (!category) continue;

        const dedupeKey = `${category}:${article.date}`;
        if (seenOverhang.has(dedupeKey)) continue;
        seenOverhang.add(dedupeKey);

        const matchedDrawdown = drawdowns.find(d => {
          const diffDays =
            Math.abs(new Date(d.date).getTime() - new Date(article.date).getTime()) /
            (24 * 60 * 60 * 1000);
          return diffDays <= 2;
        });

        // Resolve via regex: look at FMP articles after this date.
        const laterFmp = filteredFmp.filter(n => newsPublishedDate(n) > article.date);
        const title200 = article.title.length > 200
          ? article.title.slice(0, 197) + '...'
          : article.title;

        overhangs.push({
          category,
          description: title200,
          detectedDate: article.date,
          drawdownPct: matchedDrawdown?.drawdownPct ?? null,
          resolved: detectResolutionRegex(article.date, laterFmp),
          source: article.url || article.site || 'news',
        });
      }
    }

    // ── Price-action path (always active) ─────────────────────────────────────
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
        severity: dropSeverity(d.drawdownPct),
        description: `Unexplained ${d.drawdownPct}% single-day drop`,
        detectedDate: d.date,
        drawdownPct: d.drawdownPct,
        resolved: false,
        source: 'price_action',
      });
    }

    // Return newest-first (matches original ordering).
    overhangs.sort((a, b) => (a.detectedDate < b.detectedDate ? 1 : -1));

    const baseHeadlines: RawHeadline[] = allArticles.map(a => ({
      date: a.date,
      title: a.title,
      source: a.site || a.url || 'fmp',
    }));

    let newsOverall: NewsOverallSentiment | null = llmClassification?.overall ?? null;
    let rawHeadlines = baseHeadlines;
    if (llmClassification) {
      rawHeadlines = mergeSentimentsIntoHeadlines(
        baseHeadlines,
        llmClassification.sentiments,
      );
    }

    return { overhangs, rawHeadlines, newsOverall };
  } catch {
    return { overhangs: [], rawHeadlines: [], newsOverall: null };
  }
}
