# Scream Test

Companion to **`lib/beatScore.ts`**:

| Module | Answers |
|--------|--------|
| Beat score | “Will EPS beat consensus?” |
| Scream test | “Is the **options chain** skewed enough to justify a directional trade?” |

Scores are independent: high beat ≠ trade; low beat ≠ no short volatility view.

## In this repo

- **`lib/screamTest.ts`** — five filters, `score` 0–5, `qualifies` when ≥4 passes **and** a single bullish/bearish bias among passers.
- **`lib/screamTestData.ts`** — maps Alpaca chains (volume/OI skew, ~25Δ IV) into inputs.
- **`/api/scream-test`** — `POST` JSON body `{ ...ScreamTestInputs }` → full result (manual / scripts).
- **Daily scan** — computes scream test alongside the brief and persists to **`earnings_briefs`** (`scream_*` columns).
- **`supabase/migrations/0002_scream_test.sql`** — adds columns + index.

## Applying the migration

Run after `0001_init.sql`:

```bash
psql "$DATABASE_URL" -f supabase/migrations/0002_scream_test.sql
```

## v1 gaps (easy to extend)

- **`zacksEsp`** — wired as `null` until a pinned FMP/consensus-derived proxy exists.
- **`peerEarningsReactionsPct`** — empty → sector tailwind filter usually stays “fail” until you maintain a ticker→peers map.
- **`hasRegulatoryOverhang`** — default `false`; flag manually later if needed.

Append nightly notes under `docs/scream-results/YYYY-MM-DD.md` when you journal runs.
