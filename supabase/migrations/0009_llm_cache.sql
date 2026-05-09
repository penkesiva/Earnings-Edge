-- LLM headline classification cache.
-- Keyed by (ticker, scan_date) so multiple rescans on the same day share one
-- LLM call, but a scan on a new day fetches fresh results (new headlines may
-- have been published since the previous scan).
CREATE TABLE IF NOT EXISTS llm_scan_cache (
  ticker     text        NOT NULL,
  scan_date  date        NOT NULL,
  risks      jsonb       NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (ticker, scan_date)
);
