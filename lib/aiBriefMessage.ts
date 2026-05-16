import type { AiBriefPayload } from '@/components/AiBriefAnalysis';
import { appendNewsSections } from '@/lib/newsSentiment';

/** Build the user message for GPT / Gemini / Claude earnings analysis. */
export function buildAiBriefUserMessage(brief: AiBriefPayload): string {
  const lines: string[] = [];
  const pc = brief.put_call_ratio;

  lines.push(`## Ticker: ${brief.ticker}  |  Earnings: ${brief.earnings_date}`);
  lines.push('');
  lines.push(`## Beat Probability Score: ${brief.composite_score}/100`);
  lines.push('Components (0–100 each):');
  lines.push(`  Beat streak history     : ${brief.beat_streak_score ?? '—'}`);
  lines.push(`  EPS surprise magnitude  : ${brief.surprise_magnitude_score ?? '—'}`);
  lines.push(`  Analyst revision trend  : ${brief.revision_trend_score ?? '—'}`);
  lines.push(`  Whisper vs consensus    : ${brief.whisper_delta_score ?? '—'}`);
  lines.push(`  IV rank score           : ${brief.iv_rank_score ?? '—'}`);
  lines.push(`  Sector momentum (5d)    : ${brief.sector_momentum_score ?? '—'}`);
  lines.push(`  Insider buying (90d)    : ${brief.insider_score ?? '—'}`);
  lines.push('');
  lines.push('## Options Environment');
  lines.push(`  IV Rank         : ${brief.iv_rank ?? '—'}`);
  lines.push(
    `  IV 30d          : ${brief.iv_30d != null ? `${(brief.iv_30d * 100).toFixed(1)}%` : '—'}`,
  );
  lines.push(
    `  Expected Move   : ±$${brief.expected_move_dollar?.toFixed(2) ?? '—'} (±${brief.expected_move_pct?.toFixed(1) ?? '—'}%)`,
  );
  lines.push(
    `  Put/Call Ratio  : ${pc?.toFixed(2) ?? '—'} — ${
      pc == null
        ? 'no data'
        : pc < 0.7
          ? 'strongly call-heavy (bullish flow)'
          : pc < 0.9
            ? 'slight call lean'
            : pc <= 1.1
              ? 'balanced'
              : pc <= 1.4
                ? 'slight put lean'
                : 'strongly put-heavy (bearish flow)'
    }`,
  );
  lines.push('');
  lines.push('## Options Chain Analysis (Scream Test)');
  lines.push(`  Direction : ${brief.scream_direction?.toUpperCase() ?? 'NONE'}`);
  lines.push(`  Score     : ${brief.scream_score ?? 0}/5 conviction filters passed`);
  lines.push(
    `  Qualifies : ${brief.scream_qualifies ? 'YES — strong institutional positioning detected' : 'NO — mixed or insufficient chain signal'}`,
  );
  if (brief.scream_notes) {
    const raw = brief.scream_notes;
    const notes = Array.isArray(raw)
      ? (raw as string[]).slice(0, 3).join('; ')
      : String(raw).split('\n').slice(0, 3).join('; ');
    lines.push(`  Notes     : ${notes}`);
  }
  lines.push('');
  lines.push('## System Recommendation');
  lines.push(`  Action    : ${brief.final_action ?? 'N/A'}`);
  if (brief.final_action_rationale) {
    lines.push(`  Rationale : ${brief.final_action_rationale}`);
  }
  lines.push('');

  appendNewsSections(lines, {
    overhangs: brief.overhangs ?? [],
    rawHeadlines: brief.raw_headlines,
    newsOverall: brief.news_sentiment ?? null,
  });

  return lines.join('\n');
}
