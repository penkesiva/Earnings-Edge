-- Per-headline + overall news sentiment from single LLM batch call

alter table earnings_briefs
  add column if not exists news_sentiment jsonb;

comment on column earnings_briefs.news_sentiment is
  'LLM overall news bias: { bias, bullish, bearish, neutral, summary }';

alter table llm_scan_cache
  add column if not exists headline_sentiments jsonb not null default '[]'::jsonb;

alter table llm_scan_cache
  add column if not exists news_overall jsonb;
