/**
 * Provider interfaces — decouple PredictMarket from specific vendors.
 */

import type { AlpacaAuth } from '@/lib/alpaca';

export type MarketSnapshotInput = {
  sessionDate: string;
  asOfPt: string;
  /** Cutoff: only data available before this instant should be used (no look-ahead). */
  asOfInstant: Date;
};

export type MarketDataBundle = {
  provenance: 'ACTUAL' | 'CALCULATED';
  spx?: { price: number | null; previousClose: number | null };
  es?: { price: number | null; changePct: number | null };
  nq?: { price: number | null; changePct: number | null };
  vix?: { level: number | null; changePct: number | null };
  treasuries?: {
    y2: number | null;
    y10: number | null;
    y30: number | null;
    spread10y2y: number | null;
  };
  dxy?: { level: number | null; changePct: number | null };
  technical?: Record<string, number | null>;
  missing: string[];
};

export interface MarketDataProvider {
  collect(session: MarketSnapshotInput, auth?: AlpacaAuth | null): Promise<MarketDataBundle>;
}

export type NewsItem = {
  headline: string;
  classification: 'BULLISH' | 'BEARISH' | 'UNCERTAIN';
  impact: 'LOW' | 'MEDIUM' | 'HIGH';
  mechanism: string;
  source: { name: string; url?: string | null; retrievedAt: string };
};

export interface NewsProvider {
  research(sessionDate: string, asOfInstant: Date): Promise<NewsItem[]>;
}

export type EconomicEventRow = {
  event: string;
  timePt?: string | null;
  importance?: string | null;
  consensus?: string | null;
  previous?: string | null;
  actual?: string | null;
};

export interface EconomicCalendarProvider {
  forSession(sessionDate: string): Promise<EconomicEventRow[]>;
}

export type SocialSentimentBundle = {
  score: number;
  bullishPct?: number | null;
  bearishPct?: number | null;
  themes: string[];
};

export interface SocialSentimentProvider {
  sample(asOfInstant: Date): Promise<SocialSentimentBundle | null>;
}

export interface PredictMarketLlmProvider {
  generatePrediction(input: {
    phase: 'NIGHT' | 'PREMARKET';
    sessionDate: string;
    market: MarketDataBundle;
    historicalStats: string;
    news: NewsItem[];
    economic: EconomicEventRow[];
  }): Promise<{ structured: Record<string, unknown>; reasoning: string }>;
}
