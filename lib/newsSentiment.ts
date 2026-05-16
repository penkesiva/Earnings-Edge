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
): { label: string; sub: string; cls: string } | null {
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

  if (newsOverall) {
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
