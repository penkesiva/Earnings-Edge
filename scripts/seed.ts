/**
 * Seed your watchlist with the NVDA-ecosystem names.
 * Run: pnpm seed
 */

import { createClient } from '@supabase/supabase-js';
import { config } from 'dotenv';

config({ path: '.env.local' });

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const SEED = [
  // NVDA ecosystem
  { ticker: 'NVDA', thesis: 'Core AI compute — anchor position' },
  { ticker: 'LITE', thesis: 'NVDA optics partner — $2B + capacity rights' },
  { ticker: 'COHR', thesis: 'NVDA optics partner — $2B + capacity rights' },
  { ticker: 'INTC', thesis: 'NVDA $7.9B stake — foundry turnaround' },
  { ticker: 'OKLO', thesis: 'NVDA research collab — nuclear-AI factories' },

  // Bottleneck candidates (no NVDA stake yet — watch for next NOK pattern)
  { ticker: 'MU', thesis: 'HBM memory — most acute bottleneck' },
  { ticker: 'AMKR', thesis: 'Advanced packaging — CoWoS supply' },
  { ticker: 'VRT', thesis: 'Liquid cooling + power management' },
  { ticker: 'AVGO', thesis: 'Custom silicon + networking' },

  // Earnings tracking from prior chats
  { ticker: 'PLTR', thesis: 'Earnings tracking' },
  { ticker: 'ON', thesis: 'Earnings tracking' },
  { ticker: 'DUOL', thesis: 'Earnings tracking' },
  { ticker: 'PINS', thesis: 'Earnings tracking' },

  // Quantum (Ising sympathy)
  { ticker: 'IONQ', thesis: 'Quantum sympathy — NVDA Ising' },
  { ticker: 'RGTI', thesis: 'Quantum sympathy — NVDA Ising' },
  { ticker: 'QBTS', thesis: 'Quantum sympathy — NVDA Ising' },

  // Nuclear adjacents
  { ticker: 'SMR', thesis: 'Nuclear/AI power — NRC certified SMR' },
  { ticker: 'NNE', thesis: 'Nuclear micro-reactor speculation' },
];

async function main() {
  for (const t of SEED) {
    const { error } = await sb
      .from('watchlist')
      .upsert(t, { onConflict: 'ticker' });

    if (error) {
      console.error(`✗ ${t.ticker}: ${error.message}`);
    } else {
      console.log(`✓ ${t.ticker} — ${t.thesis}`);
    }
  }
  console.log(`\nSeeded ${SEED.length} tickers.`);
}

main().catch(console.error);
