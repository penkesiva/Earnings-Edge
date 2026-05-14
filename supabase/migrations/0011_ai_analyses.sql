-- Persisted AI analysis text per brief per provider.
-- Survives page reloads; re-running overwrites via upsert.

create table if not exists brief_ai_analyses (
  id           bigserial primary key,
  brief_id     uuid        not null references earnings_briefs(id) on delete cascade,
  provider     text        not null,   -- 'openai' | 'gemini' | 'claude'
  analysis_text text       not null,
  analyzed_at  timestamptz not null default now(),
  constraint brief_ai_analyses_brief_provider_key unique (brief_id, provider)
);

create index if not exists idx_ai_analyses_brief_id
  on brief_ai_analyses (brief_id);
