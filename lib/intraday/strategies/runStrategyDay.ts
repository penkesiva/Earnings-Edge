import { DEFAULT_BUY_WEAK_CONFIG, DEFAULT_EMA_TREND_DAY_CONFIG, DEFAULT_INTRADAY_CONFIG } from '@/lib/intraday/config/defaults';
import { simulateBuyWeakSellStrongDay } from '@/lib/intraday/strategies/buyWeakSellStrong/simulateDay';
import { simulateEmaTrendDay } from '@/lib/intraday/strategies/emaTrendDay/simulateDay';
import { simulateVwapOrDay } from '@/lib/intraday/strategies/vwapOpeningRange/simulateDay';
import {
  INTRADAY_STRATEGY_BUY_WEAK_SELL_STRONG_V1,
  INTRADAY_STRATEGY_EMA_TREND_DAY_V1,
  INTRADAY_STRATEGY_VWAP_OR_V1,
  type BacktestTrade,
  type MinuteBar,
} from '@/lib/intraday/types';

export function simulateStrategyDay(
  strategyId: string,
  sessionDate: string,
  bars: MinuteBar[],
  effectiveBudgetUsd: number,
): BacktestTrade[] {
  switch (strategyId) {
    case INTRADAY_STRATEGY_BUY_WEAK_SELL_STRONG_V1:
      return simulateBuyWeakSellStrongDay(
        sessionDate,
        bars,
        effectiveBudgetUsd,
        DEFAULT_BUY_WEAK_CONFIG,
      ).trades;
    case INTRADAY_STRATEGY_EMA_TREND_DAY_V1:
      return simulateEmaTrendDay(
        sessionDate,
        bars,
        effectiveBudgetUsd,
        DEFAULT_EMA_TREND_DAY_CONFIG,
      ).trades;
    case INTRADAY_STRATEGY_VWAP_OR_V1:
    default:
      return simulateVwapOrDay(sessionDate, bars, effectiveBudgetUsd, DEFAULT_INTRADAY_CONFIG).trades;
  }
}
