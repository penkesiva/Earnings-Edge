/**
 * Narrative overhang detector — keyword scan on FMP stable stock news + Alpaca
 * daily bars (large single-day drops). Feeds Scream Test Filter 4.
 *
 * Returns [] on missing keys, HTTP errors, or plan limits (never throws to callers).
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

function classifyHeadline(title: string, text: string): OverhangCategory | null {
  const corpus = `${title}\n${text}`;
  for (const { category, patterns } of OVERHANG_PATTERNS) {
    if (patterns.some(p => p.test(corpus))) return category;
  }
  return null;
}

function findBigDrawdowns(
  bars: AlpacaBar[],
  thresholdPct: number = 5
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
      result.push({
        date: dateStr,
        drawdownPct: Math.round(dropPct * 10) / 10,
      });
    }
  }
  return result;
}

function newsPublishedDate(row: FmpNewsRow): string {
  const d = row.publishedDate || row.date || '';
  return String(d).slice(0, 10);
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

function detectResolution(overhangDate: string, laterNews: FmpNewsRow[]): boolean {
  const RESOLUTION_PATTERNS = [
    /reaffirm(?:s|ed)?\s+guidance/i,
    /raise(?:s|d)?\s+(?:full[- ]year\s+)?guidance/i,
    /beat(?:s)?\s+expectations/i,
    /addresses?\s+(?:competitive\s+)?concerns?/i,
    /not\s+(?:a\s+)?threat/i,
    /complementary\s+(?:not\s+)?(?:competitive|displacement)/i,
  ];

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

/**
 * Returns narrative overhang rows for `computeScreamTest` (may be empty).
 *
 * @param asOfDate - YYYY-MM-DD end of bar window (defaults to US session "today").
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

    const filteredNews = news.filter(n => newsPublishedDate(n) >= start);
    const drawdowns = findBigDrawdowns((bars || []) as AlpacaBar[], 5);
    const overhangs: NarrativeOverhang[] = [];
    const seen = new Set<string>();

    for (const item of filteredNews) {
      const title = item.title ?? '';
      const text = item.text ?? '';
      const category = classifyHeadline(title, text);
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

      const laterNews = filteredNews.filter(
        n => newsPublishedDate(n) > dateKey
      );

      overhangs.push({
        category,
        description: title.length > 200 ? title.slice(0, 197) + '...' : title,
        detectedDate: dateKey,
        drawdownPct: matchedDrawdown?.drawdownPct ?? null,
        resolved: detectResolution(dateKey, laterNews),
        source: item.url || item.site || 'news',
      });
    }

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

    overhangs.sort((a, b) => (a.detectedDate < b.detectedDate ? 1 : -1));
    return overhangs;
  } catch {
    return [];
  }
}
