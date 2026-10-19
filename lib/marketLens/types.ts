/**
 * MarketLens: rare SPY intraday setups. Paper research only.
 * WAIT is the default. No live orders are sent from this module.
 */

export type SetupId = 'S1_SUPPORT_BOUNCE' | 'S2_RESISTANCE_REJECT' | 'S3_VWAP_RECLAIM' | 'S3_VWAP_REJECT';

export type Side = 'long' | 'short';

export type TradeExit = 'target' | 'stop' | 'time' | 'fomc_flat' | 'session_end';

export type ClosedTrade = {
  setup: SetupId;
  side: Side;
  signalTime: string;
  entryTime: string;
  exitTime: string;
  entry: number;
  stop: number;
  target: number;
  exit: number;
  exitReason: TradeExit;
  rMultiple: number;
  ambiguousBar: boolean;
};

export type RejectReason =
  | 'event_window'
  | 'opening_minutes'
  | 'near_close'
  | 'no_room'
  | 'weak_volume'
  | 'adverse_gap';

export type DayReplay = {
  sessionDate: string;
  priorClose: number;
  priorHigh: number;
  priorLow: number;
  trades: ClosedTrade[];
  rejects: Partial<Record<RejectReason, number>>;
  status: 'SIGNAL' | 'NO_TRADE' | 'WAIT';
  note: string;
};

export type BacktestSummary = {
  sessions: number;
  signalDays: number;
  trades: number;
  wins: number;
  losses: number;
  avgR: number | null;
  totalR: number;
  ambiguousBars: number;
};
