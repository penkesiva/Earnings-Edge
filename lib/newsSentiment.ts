/**
 * News sentiment types and helpers — populated by llmClassifier (one batch LLM call).
 */

export type HeadlineSentimentLabel = 'bullish' | 'bearish' | 'neutral';
export type HeadlineRelevance = 'low' | 'medium' | 'high';
export type NewsBias = 'bullish' | 'bearish' | 'mixed' | 'neutral';

export type HeadlineSentiment = {
  i: number;
  sentiment: HeadlineSentimentLabel;
  relevance: HeadlineRelevance;
  note?: string;
};

export type NewsOverallSentiment = {
  bias: NewsBias;
  bullish: number;
  bearish: number;
  neutral: number;
  summary: string;
};

export type RawHeadline = {
  date: string;
  title: string;
  source: string;
  sentiment?: HeadlineSentimentLabel;
  relevance?: HeadlineRelevance;
  note?: string;
};

export function emptyNewsOverall(summary = 'No headlines analyzed.'): NewsOverallSentiment {
  return { bias: 'neutral', bullish: 0, bearish: 0, neutral: 0, summary };
}

export function hasNewsHeadlines(raw: RawHeadline[] | null | undefined): boolean {
  return (raw?.length ?? 0) > 0;
}

/** True when LLM overall bias is meaningful (headlines existed and were classified). */
export function isActionableNewsOverall(
  overall: NewsOverallSentiment | null | undefined,
  rawHeadlines: RawHeadline[] | null | undefined,
): boolean {
  if (!overall || !hasNewsHeadlines(rawHeadlines)) return false;
  if (
    overall.summary === 'No headlines analyzed.' &&
    overall.bullish === 0 &&
    overall.bearish === 0 &&
    overall.neutral === 0
  ) {
    return false;
  }
  return true;
}

export type NewsSentimentDisplay = {
  badge: { label: string; cls: string };
  summary: string;
};

export function newsInsightFromNoData(): { label: string; sub: string; cls: string } {
  return { label: 'NO NEWS', sub: 'headlines unavailable', cls: 'text-fg-dim' };
}

/** Badge + summary for NEWS SENTIMENT section and insight strip. */
export function getNewsSentimentDisplay(
  newsOverall: NewsOverallSentiment | null | undefined,
  rawHeadlines: RawHeadline[] | null | undefined,
  riskCount: number,
  maxSeverity: number,
): NewsSentimentDisplay {
  if (!hasNewsHeadlines(rawHeadlines)) {
    if (riskCount === 0) {
      return {
        badge: { label: 'NO NEWS DATA', cls: 'bg-bg text-fg-dim border-border-subtle' },
        summary:
          'No headlines returned from FMP or Gemini search in the 60-day window. Re-run system scan and verify FMP_API_KEY.',
      };
    }
    if (riskCount <= 2 && maxSeverity <= 3) {
      return {
        badge: { label: 'NO NEWS DATA', cls: 'bg-bg text-fg-dim border-border-subtle' },
        summary: `${riskCount} price/news risk${riskCount > 1 ? 's' : ''} flagged, but headline sentiment was not loaded. Re-run system scan.`,
      };
    }
    return {
      badge: { label: 'NO NEWS DATA', cls: 'bg-bg text-fg-dim border-border-subtle' },
      summary: `${riskCount} risks flagged (incl. price action) — headline feed empty. Re-run system scan.`,
    };
  }

  if (isActionableNewsOverall(newsOverall, rawHeadlines) && newsOverall) {
    const biasLabel =
      newsOverall.bias === 'bullish' ? 'BULLISH BIAS' :
      newsOverall.bias === 'bearish' ? 'BEARISH BIAS' :
      newsOverall.bias === 'mixed' ? 'MIXED BIAS' :
      'NEUTRAL BIAS';
    const biasCls =
      newsOverall.bias === 'bullish' ? 'bg-signal-buy/10 text-signal-buy border-signal-buy/20' :
      newsOverall.bias === 'bearish' ? 'bg-signal-sell/10 text-signal-sell border-signal-sell/20' :
      newsOverall.bias === 'mixed' ? 'bg-signal-watch/10 text-signal-watch border-signal-watch/20' :
      'bg-bg text-fg-muted border-border-subtle';
    return {
      badge: { label: biasLabel, cls: biasCls },
      summary: `${newsOverall.summary} (${newsOverall.bullish}↑ ${newsOverall.bearish}↓ ${newsOverall.neutral}—)`,
    };
  }

  if (riskCount === 0) {
    return {
      badge: { label: 'CLEAN', cls: 'bg-signal-buy/10 text-signal-buy border-signal-buy/20' },
      summary: 'Headlines loaded; no material risk signals at scan time. Re-run scan for sentiment tags.',
    };
  }
  if (riskCount <= 2 && maxSeverity <= 3) {
    return {
      badge: { label: 'CAUTIOUS', cls: 'bg-signal-watch/10 text-signal-watch border-signal-watch/20' },
      summary: `${riskCount} minor concern${riskCount > 1 ? 's' : ''} — monitor but not disqualifying.`,
    };
  }
  return {
    badge: { label: 'ELEVATED RISK', cls: 'bg-signal-sell/10 text-signal-sell border-signal-sell/20' },
    summary: `${riskCount} unresolved risk${riskCount > 1 ? 's' : ''} — material headwinds into earnings.`,
  };
}

/** Merge per-index sentiment into raw headline rows (same order as scan list). */
export function mergeSentimentsIntoHeadlines(
  headlines: RawHeadline[],
  sentiments: HeadlineSentiment[],
): RawHeadline[] {
  const byI = new Map(sentiments.map(s => [s.i, s]));
  return headlines.map((h, i) => {
    const s = byI.get(i);
    if (!s) return h;
    return {
      ...h,
      sentiment: s.sentiment,
      relevance: s.relevance,
      ...(s.note?.trim() ? { note: s.note.trim() } : {}),
    };
  });
}

const BIAS_LABEL: Record<NewsBias, string> = {
  bullish: 'BULLISH',
  bearish: 'BEARISH',
  mixed: 'MIXED',
  neutral: 'NEUTRAL',
};

/** Insight strip label when LLM overall sentiment is available. */
export function newsInsightFromOverall(
  overall: NewsOverallSentiment | null | undefined,
  rawHeadlines?: RawHeadline[] | null,
): { label: string; sub: string; cls: string } | null {
  if (!isActionableNewsOverall(overall, rawHeadlines)) return null;
  if (!overall) return null;
  const counts = `${overall.bullish}↑ ${overall.bearish}↓ ${overall.neutral}—`;
  const cls =
    overall.bias === 'bullish' ? 'text-signal-buy' :
    overall.bias === 'bearish' ? 'text-signal-sell' :
    overall.bias === 'mixed' ? 'text-signal-watch' :
    'text-fg-muted';
  return {
    label: BIAS_LABEL[overall.bias],
    sub: counts,
    cls,
  };
}

/** Fallback insight strip when only risk overhangs exist (pre-rescan briefs). */
export function newsInsightFromRisks(
  riskCount: number,
  maxSeverity: number,
): { label: string; sub: string; cls: string } {
  if (riskCount === 0) {
    return { label: 'CLEAN ✓', sub: 'no material risks', cls: 'text-signal-buy' };
  }
  if (riskCount <= 2 && maxSeverity <= 3) {
    return { label: `${riskCount} RISKS`, sub: 'monitor closely', cls: 'text-signal-watch' };
  }
  return {
    label: `${riskCount} RISKS ⚠`,
    sub: maxSeverity >= 4 ? 'material headwinds' : 'monitor closely',
    cls: 'text-signal-sell',
  };
}

export function sentimentChipClass(sentiment: HeadlineSentimentLabel | undefined): string {
  if (sentiment === 'bullish') return 'text-signal-buy border-signal-buy/30 bg-signal-buy/10';
  if (sentiment === 'bearish') return 'text-signal-sell border-signal-sell/30 bg-signal-sell/10';
  return 'text-fg-dim border-border-subtle bg-bg';
}

export function sentimentChipLabel(sentiment: HeadlineSentimentLabel | undefined): string {
  if (sentiment === 'bullish') return '↑';
  if (sentiment === 'bearish') return '↓';
  return '—';
}

/** Lines for AI analysis user message (shared across GPT / Gemini / Claude). */
export function appendNewsSections(
  lines: string[],
  opts: {
    overhangs: { severity?: number | null; category: string; description: string }[];
    rawHeadlines: RawHeadline[] | null;
    newsOverall: NewsOverallSentiment | null;
  },
): void {
  const { overhangs, rawHeadlines, newsOverall } = opts;

  if (isActionableNewsOverall(newsOverall, rawHeadlines) && newsOverall) {
    lines.push('## News Sentiment (LLM, all headlines)');
    lines.push(
      `  Overall bias : ${newsOverall.bias.toUpperCase()} (${newsOverall.bullish} bullish, ${newsOverall.bearish} bearish, ${newsOverall.neutral} neutral)`,
    );
    lines.push(`  Summary      : ${newsOverall.summary}`);
    lines.push('');
  }

  const unresolved = overhangs.filter(o => !('resolved' in o) || !(o as { resolved?: boolean }).resolved);
  const risks = unresolved.length > 0 ? overhangs : overhangs;
  if (risks.length > 0) {
    lines.push(`## News & Sentiment Risks (${risks.length} flagged)`);
    for (const o of risks) {
      lines.push(`  [S${o.severity ?? '?'} ${o.category}] ${o.description}`);
    }
  } else if (!hasNewsHeadlines(rawHeadlines)) {
    lines.push('## News Sentiment: NO HEADLINES — FMP/search returned none in the 60-day window');
  } else if (!newsOverall) {
    lines.push('## News & Sentiment: CLEAN — no material risks detected in recent headlines');
  } else {
    lines.push('## News & Sentiment Risks: none flagged at material severity');
  }

  const headlines = rawHeadlines ?? [];
  if (headlines.length > 0) {
    lines.push('');
    lines.push(`## Raw News Headlines (${headlines.length} total, oldest first)`);
    lines.push(
      'Per-headline sentiment tags (↑ bullish, ↓ bearish, — neutral). Form your own independent view.',
    );
    for (const h of headlines) {
      const tag = h.sentiment ? ` [${h.sentiment}${h.relevance ? `/${h.relevance}` : ''}]` : '';
      const note = h.note ? ` — ${h.note}` : '';
      lines.push(`  (${h.date})${tag} ${h.title}${note}`);
    }
  }
}
