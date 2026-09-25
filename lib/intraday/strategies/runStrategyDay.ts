import { DEFAULT_BUY_WEAK_CONFIG, DEFAULT_EMA_TREND_DAY_CONFIG, DEFAULT_INTRADAY_CONFIG } from '@/lib/intraday/config/defaults';
import { DEFAULT_EMA_TREND_DAY_V2_CONFIG } from '@/lib/intraday/strategies/emaTrendDayV2/config';
import { simulateBuyWeakSellStrongDay } from '@/lib/intraday/strategies/buyWeakSellStrong/simulateDay';
import { simulateEmaTrendDayV2 } from '@/lib/intraday/strategies/emaTrendDayV2/simulateDay';
import { simulateEmaTrendDay } from '@/lib/intraday/strategies/emaTrendDay/simulateDay';
import { trendResumptionV1Config } from '@/lib/intraday/strategies/trendResumptionV1/config';
import { simulateTrendResumptionV1 } from '@/lib/intraday/strategies/trendResumptionV1/simulateDay';
import { simulateVwapOrDay } from '@/lib/intraday/strategies/vwapOpeningRange/simulateDay';
import {
  INTRADAY_STRATEGY_BUY_WEAK_SELL_STRONG_V1,
  INTRADAY_STRATEGY_EMA_TREND_DAY_V1,
  INTRADAY_STRATEGY_EMA_TREND_DAY_V2,
  INTRADAY_STRATEGY_TREND_RESUMPTION_V1_EARLY,
  INTRADAY_STRATEGY_TREND_RESUMPTION_V1_CONFIRMED,
  INTRADAY_STRATEGY_VWAP_OR_V1,
  type BacktestTrade,
  type MinuteBar,
  type SignalLogEntry,
} from '@/lib/intraday/types';

export type StrategyDaySimResult = {
  trades: BacktestTrade[];
  signalLog?: SignalLogEntry[];
};

export function simulateStrategyDay(
  strategyId: string,
  sessionDate: string,
  bars: MinuteBar[],
  effectiveBudgetUsd: number,
): StrategyDaySimResult {
  switch (strategyId) {
    case INTRADAY_STRATEGY_BUY_WEAK_SELL_STRONG_V1:
      return {
        trades: simulateBuyWeakSellStrongDay(
          sessionDate,
          bars,
          effectiveBudgetUsd,
          DEFAULT_BUY_WEAK_CONFIG,
        ).trades,
      };
    case INTRADAY_STRATEGY_EMA_TREND_DAY_V2: {
      const r = simulateEmaTrendDayV2(
        sessionDate,
        bars,
        effectiveBudgetUsd,
        DEFAULT_EMA_TREND_DAY_V2_CONFIG,
      );
      return { trades: r.trades, signalLog: r.signalLog };
    }
    case INTRADAY_STRATEGY_EMA_TREND_DAY_V1:
      return {
        trades: simulateEmaTrendDay(
          sessionDate,
          bars,
          effectiveBudgetUsd,
          DEFAULT_EMA_TREND_DAY_CONFIG,
        ).trades,
      };
    case INTRADAY_STRATEGY_TREND_RESUMPTION_V1_EARLY:
      return {
        trades: simulateTrendResumptionV1(
          sessionDate,
          bars,
          effectiveBudgetUsd,
          trendResumptionV1Config('EARLY_RESUMPTION'),
        ).trades,
      };
    case INTRADAY_STRATEGY_TREND_RESUMPTION_V1_CONFIRMED:
      return {
        trades: simulateTrendResumptionV1(
          sessionDate,
          bars,
          effectiveBudgetUsd,
          trendResumptionV1Config('CONFIRMED_RESUMPTION'),
        ).trades,
      };
    case INTRADAY_STRATEGY_VWAP_OR_V1:
    default:
      return {
        trades: simulateVwapOrDay(sessionDate, bars, effectiveBudgetUsd, DEFAULT_INTRADAY_CONFIG)
          .trades,
      };
  }
}
