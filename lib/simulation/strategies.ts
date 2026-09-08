import type { Series } from "./series";
import type { StrategyId, StrategyParams, TradeDirection } from "@/lib/types/simulation";

export type StrategySignal = { direction: TradeDirection; reason: string };

export type StrategyContext = {
  series: Series;
  index: number;
  params: StrategyParams;
};

export type StrategyModule = {
  id: StrategyId;
  label: string;
  description: string;
  /**
   * Evaluated on a fully closed bar. Implementations may only read series values
   * at `index` or earlier; the engine fills the resulting order at the next bar.
   */
  evaluate(context: StrategyContext): StrategySignal | null;
};

function at(series: Array<number | null>, index: number): number | null {
  return index >= 0 && index < series.length ? series[index] : null;
}

/** All referenced values must be present, otherwise the bar is skipped. */
function ready(...values: Array<number | null>): boolean {
  return values.every((value) => value != null && Number.isFinite(value));
}

const trendFollowing: StrategyModule = {
  id: "TREND_FOLLOWING",
  label: "Trend Following",
  description: "上位EMA順列が揃い、価格がEMA20の上で押し目を作っていない継続局面。",
  evaluate({ series, index }) {
    const { close, ema20, ema50, ema200, rsi } = series;
    const fast = at(ema20, index);
    const mid = at(ema50, index);
    const slow = at(ema200, index);
    const momentum = at(rsi, index);
    if (!ready(fast, mid, slow, momentum)) return null;
    const price = close[index];
    if (mid! > slow! && price > fast! && momentum! >= 50 && momentum! <= 72) {
      return { direction: "LONG", reason: "EMA50>EMA200 かつ RSI 50-72" };
    }
    if (mid! < slow! && price < fast! && momentum! <= 50 && momentum! >= 28) {
      return { direction: "SHORT", reason: "EMA50<EMA200 かつ RSI 28-50" };
    }
    return null;
  },
};

const maCross: StrategyModule = {
  id: "MA_CROSS",
  label: "Moving Average Cross",
  description: "設定EMAのゴールデン/デッドクロス成立バー。",
  evaluate({ series, index }) {
    const fastNow = at(series.emaFast, index);
    const slowNow = at(series.emaSlow, index);
    const fastPrev = at(series.emaFast, index - 1);
    const slowPrev = at(series.emaSlow, index - 1);
    if (!ready(fastNow, slowNow, fastPrev, slowPrev)) return null;
    if (fastPrev! <= slowPrev! && fastNow! > slowNow!) {
      return { direction: "LONG", reason: "Fast EMAがSlow EMAを上抜け" };
    }
    if (fastPrev! >= slowPrev! && fastNow! < slowNow!) {
      return { direction: "SHORT", reason: "Fast EMAがSlow EMAを下抜け" };
    }
    return null;
  },
};

const emaPullback: StrategyModule = {
  id: "EMA_PULLBACK",
  label: "EMA Pullback",
  description: "上位トレンド維持のままEMA20へ押し戻り、RSIがリセットされた局面。",
  evaluate({ series, index }) {
    const { close, ema20, ema50, ema200, rsi, atr } = series;
    const fast = at(ema20, index);
    const mid = at(ema50, index);
    const slow = at(ema200, index);
    const momentum = at(rsi, index);
    const range = at(atr, index);
    if (!ready(fast, mid, slow, momentum, range)) return null;
    const price = close[index];
    const nearFast = Math.abs(price - fast!) <= range! * 0.6;
    if (mid! > slow! && nearFast && price > mid! && momentum! >= 38 && momentum! <= 58) {
      return { direction: "LONG", reason: "上昇トレンド中のEMA20押し目、RSIリセット" };
    }
    if (mid! < slow! && nearFast && price < mid! && momentum! >= 42 && momentum! <= 62) {
      return { direction: "SHORT", reason: "下降トレンド中のEMA20戻り、RSIリセット" };
    }
    return null;
  },
};

const breakout: StrategyModule = {
  id: "BREAKOUT",
  label: "Breakout",
  description: "直近レンジ高値/低値を終値で更新し、出来高が伴った局面。",
  evaluate({ series, index, params }) {
    const upper = at(series.priorHigh, index);
    const lower = at(series.priorLow, index);
    const volume = at(series.volumeRatio, index);
    if (!ready(upper, lower, volume)) return null;
    if (volume! < params.minVolumeRatio) return null;
    const price = series.close[index];
    if (price > upper!) return { direction: "LONG", reason: "直近高値を終値で更新" };
    if (price < lower!) return { direction: "SHORT", reason: "直近安値を終値で更新" };
    return null;
  },
};

const breakoutRetest: StrategyModule = {
  id: "BREAKOUT_RETEST",
  label: "Breakout Retest",
  description: "ブレイク後に同水準へ戻り、再度その上/下で終えた確認足。",
  evaluate({ series, index }) {
    const { close, high, low, priorHigh, priorLow } = series;
    for (let j = index - 5; j <= index - 1; j += 1) {
      if (j < 1) continue;
      const upper = at(priorHigh, j);
      if (upper != null && close[j] > upper) {
        if (low[index] <= upper * 1.002 && close[index] > upper) {
          return { direction: "LONG", reason: "上抜け水準のRetestを維持" };
        }
      }
      const lower = at(priorLow, j);
      if (lower != null && close[j] < lower) {
        if (high[index] >= lower * 0.998 && close[index] < lower) {
          return { direction: "SHORT", reason: "下抜け水準のRetestを維持" };
        }
      }
    }
    return null;
  },
};

const rsiMeanReversion: StrategyModule = {
  id: "RSI_MEAN_REVERSION",
  label: "RSI Mean Reversion",
  description: "RSI極値。ただし上位トレンドに逆行する側は取らない。",
  evaluate({ series, index, params }) {
    const momentum = at(series.rsi, index);
    const slow = at(series.ema200, index);
    if (!ready(momentum, slow)) return null;
    const price = series.close[index];
    if (momentum! <= params.rsiOversold && price > slow!) {
      return { direction: "LONG", reason: `RSI<=${params.rsiOversold} かつ EMA200上` };
    }
    if (momentum! >= params.rsiOverbought && price < slow!) {
      return { direction: "SHORT", reason: `RSI>=${params.rsiOverbought} かつ EMA200下` };
    }
    return null;
  },
};

const bollingerReversion: StrategyModule = {
  id: "BOLLINGER_REVERSION",
  label: "Bollinger Band Mean Reversion",
  description: "バンド外終値かつRSIが同方向に振れた行き過ぎ局面。",
  evaluate({ series, index }) {
    const upper = at(series.bbUpper, index);
    const lower = at(series.bbLower, index);
    const momentum = at(series.rsi, index);
    if (!ready(upper, lower, momentum)) return null;
    const price = series.close[index];
    if (price < lower! && momentum! < 40) {
      return { direction: "LONG", reason: "下バンド外かつRSI<40" };
    }
    if (price > upper! && momentum! > 60) {
      return { direction: "SHORT", reason: "上バンド外かつRSI>60" };
    }
    return null;
  },
};

const vwapReversion: StrategyModule = {
  id: "VWAP_REVERSION",
  label: "VWAP Reversion",
  description: "上位トレンド方向を保ったままVWAPから1ATR以上乖離した局面。",
  evaluate({ series, index }) {
    const anchor = at(series.vwap, index);
    const range = at(series.atr, index);
    const mid = at(series.ema50, index);
    const slow = at(series.ema200, index);
    if (!ready(anchor, range, mid, slow)) return null;
    const price = series.close[index];
    if (mid! > slow! && anchor! - price >= range!) {
      return { direction: "LONG", reason: "上昇トレンド中のVWAP下方乖離" };
    }
    if (mid! < slow! && price - anchor! >= range!) {
      return { direction: "SHORT", reason: "下降トレンド中のVWAP上方乖離" };
    }
    return null;
  },
};

const volatilityExpansion: StrategyModule = {
  id: "VOLATILITY_EXPANSION",
  label: "Volatility Expansion",
  description: "ATRが自身の中位水準を大きく上回りつつレンジを更新した局面。",
  evaluate({ series, index, params }) {
    const range = at(series.atrPct, index);
    const median = at(series.atrPctMedian, index);
    const upper = at(series.priorHigh, index);
    const lower = at(series.priorLow, index);
    const volume = at(series.volumeRatio, index);
    if (!ready(range, median, upper, lower, volume)) return null;
    if (range! < median! * 1.5 || volume! < params.minVolumeRatio) return null;
    const price = series.close[index];
    if (price > upper!) return { direction: "LONG", reason: "ATR拡大を伴う上方ブレイク" };
    if (price < lower!) return { direction: "SHORT", reason: "ATR拡大を伴う下方ブレイク" };
    return null;
  },
};

export const STRATEGY_MODULES: StrategyModule[] = [
  trendFollowing,
  maCross,
  emaPullback,
  breakout,
  breakoutRetest,
  rsiMeanReversion,
  bollingerReversion,
  vwapReversion,
  volatilityExpansion,
];

export const STRATEGY_BY_ID = new Map(STRATEGY_MODULES.map((module) => [module.id, module]));

export const DEFAULT_STRATEGY_PARAMS: StrategyParams = {
  rsiOversold: 30,
  rsiOverbought: 70,
  emaFast: 20,
  emaSlow: 50,
  atrStopMultiplier: 1.5,
  target1R: 1.5,
  target2R: 3,
  target1Fraction: 0.5,
  breakoutLookback: 20,
  minVolumeRatio: 1.2,
};
