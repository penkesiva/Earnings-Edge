-- Store the raw merged headline list (FMP + Gemini search) at scan time
-- so AI analysis endpoints can reason on actual news text, not just classified summaries.

alter table earnings_briefs
  add column if not exists raw_headlines jsonb;
