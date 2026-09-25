/**
 * PredictMarket shared types — structured prediction JSON + enums.
 */

export type PredictDirection = 'GREEN' | 'RED' | 'NEUTRAL';
export type PredictTradeBias = 'CALL' | 'PUT' | 'NO_TRADE';
export type PredictionType = 'NIGHT' | 'PREMARKET';
export type EntryRecommendation = 'CALL' | 'PUT' | 'WAIT' | 'NO_TRADE';
export type ThesisStatus = 'CONFIRMED' | 'WEAKENING' | 'INVALIDATED' | 'REVERSING' | 'PENDING';

export type PredictMarketPhase =
  | 'night'
  | 'premarket'
  | 'open'
  | 'entry'
  | 'validate_7am'
  | 'validate_10am'
  | 'grade';

export type PredictionRecord = {
  session_date: string;
  prediction_time: string;
  prediction_type: PredictionType;
  direction: PredictDirection;
  confidence: number;
  expected_open_direction?: string | null;
  expected_gap_percent?: number | null;
  expected_low?: number | null;
  expected_high?: number | null;
  expected_close?: number | null;
  expected_day_return_percent?: number | null;
  trade_bias: PredictTradeBias;
  bullish_score?: number | null;
  bearish_score?: number | null;
  top_bullish_factors: string[];
  top_bearish_factors: string[];
  key_levels: Record<string, number | null>;
  invalidation_conditions: string[];
  input_snapshot_id?: string | null;
};

export type OutcomeRecord = {
  session_date: string;
  previous_close: number | null;
  open: number | null;
  high: number | null;
  low: number | null;
  close: number | null;
  gap_percent: number | null;
  daily_return_percent: number | null;
  intraday_range_percent: number | null;
  actual_direction: 'GREEN' | 'RED' | 'NEUTRAL' | null;
};

export type ProvenanceTag = 'ACTUAL' | 'CALCULATED' | 'LLM_INTERPRETATION';

export type FieldProvenance = {
  value: unknown;
  tag: ProvenanceTag;
  source?: string | null;
};
