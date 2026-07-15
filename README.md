# Earnings Edge

Personal pre-earnings decision engine: discover upcoming names, score them, run multi-model consensus, and optionally paper-trade GO verdicts.

Google sign-in (Supabase Auth). Per-user watchlists and Alpaca keys (RLS). Hosted on Vercel.

## What shipped

| Area | Route | Notes |
|------|--------|--------|
| Google OAuth + allowlist | `/login`, `/settings` | `AUTH_REQUIRED` / `AUTH_ALLOWED_EMAILS` |
| Watchlist + earnings discovery | `/watchlist` | FMP 14d calendar · US-listed common · ≥$5 · ≥$2B · no pharma · dismiss memory |
| Home briefs + Top 10 | `/` | Daily scan briefs, year-round Top 10, Scan All |
| Multi-LLM consensus | brief + Scan All | OpenAI / Gemini / Claude → GO / NO-GO |
| Paper auto-trade | `/trade` | Consensus GO, kill switch, order log; pre-close cron (3pm ET) enters today's AMC + next-day BMO when Auto is ON |
| History / outcomes | `/history` | Log beat/miss + next-day move |
| System health | `/status` | Login-only · phases, env, table probes |

Live checklist for agents/ops: `lib/systemStatusManifest.ts` (also drives `/status`).

## Stack

- **Next.js 14** (App Router) on Vercel
- **Supabase** Postgres + Auth (Google) + RLS
- **FMP** — earnings calendar, fundamentals, surprises
- **Alpaca** — prices, options, paper/live trading (per-user keys in Settings; env fallback)
- **Resend** — optional morning email (`NOTIFY_EMAIL`)
- **Twilio WhatsApp** — optional auto-trade run summaries (`TWILIO_*`, `NOTIFY_WHATSAPP_TO`)
- **Vercel Cron** — weekday daily scan (`0 13 * * 1-5` UTC ≈ 6am PT), Sunday calendar refresh, weekday auto-trade (`0 19 * * 1-5` UTC ≈ 3pm ET, ~1h before close)

## Quick start

```bash
pnpm install
cp .env.example .env.local   # fill keys — see .env.example
```

### Database

On a **fresh** project:

1. Run `supabase/schema.sql`
2. Run migrations in order under `supabase/migrations/` (at least `0012`–`0019`)

`schema.sql` alone is not enough for multi-user auth, discovery, or trade tables. Prefer applying every file in `supabase/migrations/`.

### Auth (Google)

1. Enable Google provider in Supabase Auth
2. Set redirect URLs to include `https://<host>/auth/callback`
3. Set `AUTH_REQUIRED=true` and usually `AUTH_ALLOWED_EMAILS=you@gmail.com`
4. Set `NEXT_PUBLIC_SITE_URL` to the deployed origin

### Deploy

Connect the repo to Vercel, set env vars from `.env.example`, deploy. Crons start from `vercel.json`.

Confirm production with **`/status`** after login.

## Daily flow

```
Watchlist → FETCH EARNINGS (US-listed filter) → ADD names
     ↓
Sync calendar / weekly cron
     ↓
Weekday 6am PT cron → daily-scan → beat score + scream + structure → briefs
     ↓
Home / brief → Scan All (3 LLMs) → consensus
     ↓
Optional: /trade → Run now (paper) on consensus GO
     ↓
/history → log outcomes
```

## Discovery filters (`/watchlist`)

Implemented in `lib/earningsDiscoveryFilter.ts`:

- Common equity only (drops preferreds like `BAC-PK`, warrants, units)
- US-listed exchanges (NYSE / Nasdaq / Amex / Arca) — drops OTC foreign e.g. `CWQXY`
- Price ≥ $5, market cap ≥ $2B
- Excludes pharma / biotech / therapeutics
- Dismissed tickers stay hidden on refetch; already-added names are skipped (see fetch status line)

## Beat score weights

Edit `lib/beatScore.ts`:

| Signal | Default |
|--------|---------|
| Beat streak (last 4Q) | 20% |
| Surprise magnitude | 15% |
| Analyst revisions (30d) | 20% |
| Whisper vs consensus | 15% *(not fed in scan yet — stays near neutral)* |
| IV rank (inverted) | 10% |
| Sector momentum (5d) | 10% |
| Insider buying (90d) | 10% |

## Scream test

Directional options filter (independent of beat score). Details: **`docs/scream-results/README.md`**. Code: `lib/screamTest.ts`.

## Key paths

```
app/(dashboard)/page.tsx          # Home — briefs + Top 10
app/(dashboard)/watchlist/        # Watchlist + discovery
app/(dashboard)/trade/            # Auto-trade
app/(dashboard)/history/          # Outcomes
app/(dashboard)/status/           # Health
app/(dashboard)/settings/         # Google session + Alpaca keys
app/api/cron/daily-scan/          # Morning engine
app/api/cron/update-calendar/     # Weekly calendar
lib/earningsDiscovery.ts          # Fetch + store candidates
lib/earningsDiscoveryFilter.ts    # Discovery gates
lib/systemStatusManifest.ts       # /status source of truth
supabase/schema.sql               # Base schema
supabase/migrations/              # Incremental (0012–0019+)
```

## Caveats

- Whisper EPS is not wired into the daily scan yet (weight is currently wasted).
- Auto-trade places **equity** market orders, not the options structures from `structure.ts`. With Auto ON it runs on the pre-close cron; "Run now" on `/trade` is always available. Cron time is fixed UTC, so it drifts an hour vs ET when DST changes.
- Push notifications need VAPID keys; there is no in-app push subscribe UI yet.
- Email alerts go to global `NOTIFY_EMAIL`, not each user’s Google address.
- Not financial advice — decision support only.
