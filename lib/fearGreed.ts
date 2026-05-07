/**
 * CNN Business Fear & Greed Index (US equities).
 * Public JSON endpoint — include Referer to avoid bot rejection.
 * @see https://www.cnn.com/markets/fear-and-greed
 */

const CNN_FNG_URL =
  'https://production.dataviz.cnn.io/index/fearandgreed/graphdata';

/** One of CNN’s sub-indices that feed the composite (same response JSON). */
export type FearGreedComponent = {
  id: string;
  label: string;
  score: number;
  rating: string;
};

export type FearGreedSnapshot = {
  score: number;
  rating: string;
  previousClose?: number;
  /** CNN inputs that roll up into the headline composite (when API provides them). */
  components: FearGreedComponent[];
  previous1Week?: number;
  previous1Month?: number;
  previous1Year?: number;
};

const CNN_COMPONENT_IDS = [
  'market_momentum_sp500',
  'market_momentum_sp125',
  'stock_price_strength',
  'stock_price_breadth',
  'put_call_options',
  'market_volatility_vix',
  'market_volatility_vix_50',
  'junk_bond_demand',
  'safe_haven_demand',
] as const;

const CNN_COMPONENT_LABELS: Record<(typeof CNN_COMPONENT_IDS)[number], string> = {
  market_momentum_sp500: 'S&P 500 momentum',
  market_momentum_sp125: 'S&P 125 equal weight',
  stock_price_strength: 'Stock price strength',
  stock_price_breadth: 'Stock price breadth',
  put_call_options: 'Put/call options',
  market_volatility_vix: 'Market volatility (VIX)',
  market_volatility_vix_50: 'Volatility (50-day)',
  junk_bond_demand: 'Junk bond demand',
  safe_haven_demand: 'Safe haven demand',
};

function titleCaseRating(raw: string): string {
  if (!raw) return '—';
  return raw
    .split(/\s+/)
    .map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(' ');
}

function parseFngComponents(json: Record<string, unknown>): FearGreedComponent[] {
  const out: FearGreedComponent[] = [];
  for (const id of CNN_COMPONENT_IDS) {
    const block = json[id] as { score?: number; rating?: string } | undefined;
    if (!block || typeof block.score !== 'number') continue;
    out.push({
      id,
      label: CNN_COMPONENT_LABELS[id],
      score: Math.round(block.score * 10) / 10,
      rating: titleCaseRating(String(block.rating ?? '')),
    });
  }
  return out;
}

/** One of CNN’s five zones on the 0–100 composite (common bracketing). */
export type FearGreedBand = {
  label: string;
  min: number;
  max: number;
};

/**
 * Typical score windows for each CNN label (full index is always 0–100).
 * @see https://www.cnn.com/markets/fear-and-greed
 */
const CNN_BANDS: FearGreedBand[] = [
  { label: 'Extreme Fear', min: 0, max: 24 },
  { label: 'Fear', min: 25, max: 45 },
  { label: 'Neutral', min: 46, max: 54 },
  { label: 'Greed', min: 55, max: 74 },
  { label: 'Extreme Greed', min: 75, max: 100 },
];

export function bandForScore(score: number): FearGreedBand {
  const s = Math.min(100, Math.max(0, score));
  for (const b of CNN_BANDS) {
    if (s >= b.min && s <= b.max) return b;
  }
  return CNN_BANDS[2];
}

export async function getCnnFearGreed(): Promise<FearGreedSnapshot | null> {
  try {
    const res = await fetch(CNN_FNG_URL, {
      headers: {
        Accept: 'application/json',
        'User-Agent':
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        Referer: 'https://www.cnn.com/markets/fear-and-greed',
      },
      next: { revalidate: 900 },
    });

    if (!res.ok) return null;

    const json = (await res.json()) as Record<string, unknown>;

    const fg = json.fear_and_greed as
      | {
          score?: number;
          rating?: string;
          previous_close?: number;
          previous_1_week?: number;
          previous_1_month?: number;
          previous_1_year?: number;
        }
      | undefined;

    if (!fg || typeof fg.score !== 'number') return null;

    const components = parseFngComponents(json);

    return {
      score: Math.round(fg.score * 10) / 10,
      rating: titleCaseRating(String(fg.rating ?? '')),
      previousClose:
        typeof fg.previous_close === 'number' ? fg.previous_close : undefined,
      components,
      previous1Week:
        typeof fg.previous_1_week === 'number' ? fg.previous_1_week : undefined,
      previous1Month:
        typeof fg.previous_1_month === 'number' ? fg.previous_1_month : undefined,
      previous1Year:
        typeof fg.previous_1_year === 'number' ? fg.previous_1_year : undefined,
    };
  } catch {
    return null;
  }
}

/** Map 0–100 score to a hue for the gauge (red → yellow → green). */
export function fearGreedHue(score: number): number {
  const s = Math.min(100, Math.max(0, score));
  return Math.round((s / 100) * 120);
}

/** Coarse dashboard mood derived from CNN’s 0–100 composite (daily, not intraday candles). */
export type TapeMood = 'green' | 'sideways' | 'red';

export type TapeMoodResult = {
  mood: TapeMood;
  label: string;
  /** Short subtitle for UI */
  blurb: string;
};

/**
 * Thresholds (~CNN neutral ± buffer):
 * - Red: fear-heavy (composite ≤ 42)
 * - Sideways: middle belt (43–56)
 * - Green: greed-heavy (≥ 57)
 */
export function tapeMoodFromFng(score: number): TapeMoodResult {
  const s = Math.min(100, Math.max(0, score));

  if (s >= 57) {
    return {
      mood: 'green',
      label: 'GREEN',
      blurb: 'Greed-heavy reading — leaning risk-on / complacency risk.',
    };
  }
  if (s <= 42) {
    return {
      mood: 'red',
      label: 'RED',
      blurb: 'Fear-heavy reading — leaning defensive / washout risk fades.',
    };
  }
  return {
    mood: 'sideways',
    label: 'SIDEWAYS',
    blurb: 'Neutral belt — appetite vs fear roughly balanced.',
  };
}
