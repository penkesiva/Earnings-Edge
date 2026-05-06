# Earnings Edge

Personal pre-earnings decision engine. Computes a beat score from multiple signals, snapshots the options chain, and tells you whether to enter, skip, or spread the trade — every morning before market open.

Built for one user (you). Lean stack. Self-hosted on Vercel.

## Stack

- **Next.js 14** (app router) on Vercel
- **Supabase** (Postgres) for state
- **Alpaca Pro API** for prices, options chains, IV, Greeks
- **FMP** ($25/mo) for EPS estimates, surprises, revisions, insider trades
- **Resend** for email
- **Vercel Cron** for the morning scan

## Setup (~30 minutes)

### 1. Clone + install
```bash
pnpm install
```

### 2. Create accounts and grab keys
- Supabase project → URL + service role key
- Alpaca Pro → API key + secret (you have this)
- FMP → $25/mo Starter tier → API key
- Resend → free tier → API key
- Vercel → connect this repo

### 3. Environment variables
Copy `.env.example` to `.env.local` and fill in:
```
NEXT_PUBLIC_SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=
ALPACA_API_KEY=
ALPACA_API_SECRET=
ALPACA_BASE_URL=https://data.alpaca.markets
FMP_API_KEY=
RESEND_API_KEY=
NOTIFY_EMAIL=siva@yourdomain.com
CRON_SECRET=  # generate any long random string
```

### 4. Run Supabase migration
```bash
psql $DATABASE_URL -f supabase/migrations/0001_init.sql
# or paste the SQL into Supabase SQL editor
```

### 5. Seed your watchlist
```bash
pnpm seed
```

### 6. Deploy
```bash
vercel --prod
```

Add the env vars in Vercel dashboard. Cron will start running 6am PT weekdays automatically.

## How it works

```
6am PT weekday
  ↓
/api/cron/daily-scan
  ↓
For each ticker reporting today:
  1. Fetch from FMP: consensus EPS, last 4Q surprises, revisions, insider
  2. Fetch from Alpaca: spot price, options chain, IV, Greeks
  3. Compute IV rank, expected move, put/call ratio
  4. Run beatScore() → 0-100 composite
  5. suggestStructure() → SKIP | SMALL_SPREAD | DIRECTIONAL | HIGH_CONVICTION
  6. Write earnings_briefs row
  7. Send email + push notification
  ↓
Dashboard auto-loads briefs at /
```

After earnings prints, you log the outcome in `/history`. Over time the database accumulates ground truth so you can backtest the scoring weights.

## Beat score weights (tunable)

Edit `lib/beatScore.ts`:
| Signal | Default weight |
|---|---|
| Beat streak (last 4Q) | 20% |
| Surprise magnitude | 15% |
| Analyst revisions (30d) | 20% |
| Whisper vs consensus | 15% |
| IV rank (inverted) | 10% |
| Sector momentum (5d) | 10% |
| Insider buying (90d) | 10% |

After ~10-15 logged outcomes, run `/api/calibrate` to see which weights correlate best with actual day-after moves.

## File map

```
app/
  api/cron/daily-scan/route.ts    # the engine
  api/cron/update-calendar/...    # weekly earnings calendar refresh
  (dashboard)/page.tsx            # today's briefs
  (dashboard)/history/page.tsx    # past briefs + outcomes
  (dashboard)/briefs/[id]/...     # detail view
lib/
  alpaca.ts                       # Alpaca client
  fmp.ts                          # FMP client
  beatScore.ts                    # the formula
  structure.ts                    # SKIP/SPREAD/DIRECTIONAL logic
  email.ts                        # Resend wrapper
  push.ts                         # Web Push (PWA)
  supabase.ts                     # DB client
supabase/migrations/
  0001_init.sql                   # schema
```

## Caveats

- Whisper numbers: EarningsWhispers has no public API. v1 skips them; you can manually input via dashboard for high-conviction names.
- Alpaca historical options data only goes back to Feb 2024 — fine for our use case.
- This is for one user. Auth is bare-bones. Don't open to the world.
- Not financial advice. The score is decision support, not a trading bot.
