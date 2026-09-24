import type { GeneratedForecast } from '@/lib/predictMarket/llm/openAiPredictMarketForecast';
import type { MarketDataBundle } from '@/lib/predictMarket/providers/types';
import type { PredictDirection } from '@/lib/predictMarket/types';

/** SPY spot ≈ SPX / 10 — used for index-level range labels in UI. */
export function spxIndexEstimate(market: MarketDataBundle): number | null {
  const fromTech = market.technical?.spx_index_estimate;
  if (fromTech != null && fromTech > 1000) return fromTech;
  const spy = market.spx?.price ?? market.spx?.previousClose;
  if (spy != null && spy > 0) return Math.round(spy * 10 * 100) / 100;
  return null;
}

function validLevel(n: number | null | undefined): number | null {
  if (n == null || !Number.isFinite(n) || n <= 0) return null;
  return n;
}

/** Fill missing/zero expected_low/high from anchor + direction (CALCULATED, not LLM). */
export function enrichForecastRange(
  forecast: GeneratedForecast,
  market: MarketDataBundle,
): GeneratedForecast {
  const anchor = spxIndexEstimate(market);
  if (!anchor) return forecast;

  const s = { ...forecast.structured };
  let low = validLevel(s.expected_low);
  let high = validLevel(s.expected_high);

  const movePct =
    Math.abs(s.expected_day_return_percent ?? 0) > 0.05
      ? Math.abs(s.expected_day_return_percent!)
      : 0.6;

  if (!low || !high) {
    const band = (anchor * movePct) / 100;
    if (s.direction === 'RED') {
      low = low ?? Math.round((anchor - band * 1.4) * 100) / 100;
      high = high ?? Math.round((anchor + band * 0.4) * 100) / 100;
    } else if (s.direction === 'GREEN') {
      low = low ?? Math.round((anchor - band * 0.4) * 100) / 100;
      high = high ?? Math.round((anchor + band * 1.4) * 100) / 100;
    } else {
      low = low ?? Math.round((anchor - band) * 100) / 100;
      high = high ?? Math.round((anchor + band) * 100) / 100;
    }
  }

  if (!validLevel(s.expected_close)) {
    const closeShift = ((s.expected_day_return_percent ?? 0) / 100) * anchor;
    s.expected_close = Math.round((anchor + closeShift) * 100) / 100;
  }

  s.expected_low = low;
  s.expected_high = high;
  s.key_levels = {
    ...s.key_levels,
    spx_index_estimate: anchor,
    previous_close_spx: market.technical?.previous_close_spx ?? null,
  };

  return { ...forecast, structured: s };
}

export function displayRangeFromPrediction(
  row: Record<string, unknown> | null | undefined,
  spxAnchorFallback?: number | null,
): string {
  if (!row) return '—';
  const structured = row.structured as Record<string, unknown> | undefined;
  let low = numOrNull(row.expected_low) ?? numOrNull(structured?.expected_low);
  let high = numOrNull(row.expected_high) ?? numOrNull(structured?.expected_high);

  if (low == null || high == null) {
    const keyLevels = structured?.key_levels as Record<string, unknown> | undefined;
    const anchor =
      numOrNull(keyLevels?.spx_index_estimate) ?? numOrNull(spxAnchorFallback);
    const dir = String(row.direction ?? structured?.direction ?? '');
    const movePct = Math.abs(Number(structured?.expected_day_return_percent ?? row.expected_day_return_percent ?? 0.6)) || 0.6;
    if (anchor != null) {
      const band = (anchor * movePct) / 100;
      if (dir === 'RED') {
        low = low ?? Math.round(anchor - band * 1.4);
        high = high ?? Math.round(anchor + band * 0.4);
      } else if (dir === 'GREEN') {
        low = low ?? Math.round(anchor - band * 0.4);
        high = high ?? Math.round(anchor + band * 1.4);
      } else {
        low = low ?? Math.round(anchor - band);
        high = high ?? Math.round(anchor + band);
      }
    }
  }

  return formatSpxRange(low, high);
}

function numOrNull(v: unknown): number | null {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n;
}

export function formatSpxRange(low: unknown, high: unknown): string {
  const l = validLevel(Number(low));
  const h = validLevel(Number(high));
  if (l == null || h == null) return '—';
  return `${l.toLocaleString(undefined, { maximumFractionDigits: 0 })} – ${h.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

export function directionTextCls(direction: string | null | undefined): string {
  if (direction === 'GREEN') return 'text-signal-buy';
  if (direction === 'RED') return 'text-signal-sell';
  if (direction === 'NEUTRAL') return 'text-signal-watch';
  return 'text-fg';
}
