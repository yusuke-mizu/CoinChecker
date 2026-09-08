import { WARMUP_BARS, buildSeries } from "./series";
import type { Series } from "./series";
import { STRATEGY_BY_ID } from "./strategies";
import type { Candle } from "@/lib/types/market";
import {
  BAR_MINUTES,
  HOLDING_MINUTES,
  type MarketRegime,
  type SimTimeframe,
  type SimTrade,
  type SimulationSettings,
  type TradeDirection,
  type VolatilityBand,
} from "@/lib/types/simulation";

/** Hard ceiling per symbol/timeframe/strategy stream, so payloads stay bounded. */
export const MAX_TRADES_PER_STREAM = 400;

const MIN_STOP_PCT = 0.25;
const MAX_STOP_PCT = 15;

export function holdingBarsFor(settings: SimulationSettings, timeframe: SimTimeframe): number {
  return Math.max(
    1,
    Math.round(HOLDING_MINUTES[settings.holding] / BAR_MINUTES[timeframe]),
  );
}

function volatilityBandAt(series: Series, index: number): VolatilityBand {
  const current = series.atrPct[index];
  const median = series.atrPctMedian[index];
  if (current == null || median == null || median <= 0) return "NORMAL_VOLATILITY";
  if (current >= median * 1.4) return "HIGH_VOLATILITY";
  if (current <= median * 0.7) return "LOW_VOLATILITY";
  return "NORMAL_VOLATILITY";
}

/** Uses only values at or before `index`, so it is safe inside the bar loop. */
function regimeAt(series: Series, index: number, band: VolatilityBand): MarketRegime {
  const recent = series.return24[index];
  const short = series.return8[index];
  const earlier = index >= 8 ? series.return24[index - 8] : null;
  const mid = series.ema50[index];
  const slow = series.ema200[index];
  const atrPct = series.atrPct[index];
  const price = series.close[index];

  if (recent != null && recent <= -12 && band === "HIGH_VOLATILITY") return "CRASH";
  if (earlier != null && earlier <= -12 && short != null && short >= 5) return "RECOVERY";
  if (mid != null && slow != null && recent != null) {
    if (mid > slow && recent >= 3) return "BULL";
    if (mid < slow && recent <= -3) return "BEAR";
    const separationPct = (Math.abs(mid - slow) / price) * 100;
    if (atrPct != null && separationPct >= atrPct) return "TRENDING";
  }
  return "RANGING";
}

function stopPriceFor(
  direction: TradeDirection,
  entry: number,
  series: Series,
  index: number,
  settings: SimulationSettings,
): number {
  const sign = direction === "LONG" ? 1 : -1;
  let stopPct: number;
  if (settings.stopMode === "FIXED") {
    stopPct = settings.fixedStopPct;
  } else {
    const range = series.atr[index] ?? entry * 0.005;
    const structural =
      direction === "LONG"
        ? Math.min(series.swingLow[index] ?? series.low[index], series.low[index])
        : Math.max(series.swingHigh[index] ?? series.high[index], series.high[index]);
    const candidate = structural - sign * range * settings.params.atrStopMultiplier;
    stopPct = (Math.abs(entry - candidate) / entry) * 100;
  }
  const bounded = Math.min(Math.max(stopPct, MIN_STOP_PCT), MAX_STOP_PCT);
  return entry * (1 - (sign * bounded) / 100);
}

function liquidationPriceFor(
  direction: TradeDirection,
  entry: number,
  leverage: number,
  maintenanceMarginRate: number,
): number {
  const sign = direction === "LONG" ? 1 : -1;
  const buffer = Math.max(1 / leverage - maintenanceMarginRate, 0.001);
  return entry * (1 - sign * buffer);
}

/**
 * Runs one symbol/timeframe across the selected strategies.
 *
 * Look-ahead protection: signals are evaluated on the closed bar `i` and filled
 * at `candles[i + 1].open`. Position management then walks forward one bar at a
 * time and may only read that bar's own high/low/close.
 */
export function runSymbolBacktest(input: {
  symbol: string;
  timeframe: SimTimeframe;
  candles: Candle[];
  settings: SimulationSettings;
}): SimTrade[] {
  const { symbol, timeframe, candles, settings } = input;
  if (candles.length < WARMUP_BARS + 5) return [];

  const series = buildSeries(candles, {
    emaFast: settings.params.emaFast,
    emaSlow: settings.params.emaSlow,
    breakoutLookback: settings.params.breakoutLookback,
  });
  const bars = holdingBarsFor(settings, timeframe);
  const barMinutes = BAR_MINUTES[timeframe];
  const { costs, params } = settings;
  const slippagePct = costs.slippageEnabled ? costs.slippagePct : 0;
  const feePct = costs.feesEnabled ? costs.takerFeePct : 0;
  const fundingPct8h = costs.fundingEnabled ? costs.fundingRatePct8h : 0;
  const trades: SimTrade[] = [];

  for (const strategyId of settings.strategies) {
    const strategy = STRATEGY_BY_ID.get(strategyId);
    if (!strategy) continue;
    let nextAvailable = WARMUP_BARS;
    let produced = 0;

    for (let i = WARMUP_BARS; i < candles.length - 1; i += 1) {
      if (produced >= MAX_TRADES_PER_STREAM) break;
      if (i < nextAvailable) continue;

      const signal = strategy.evaluate({ series, index: i, params });
      if (!signal) continue;
      if (settings.direction !== "BOTH" && signal.direction !== settings.direction) continue;

      const direction = signal.direction;
      const sign = direction === "LONG" ? 1 : -1;
      const entryIndex = i + 1;
      // Fills are adverse by the slippage assumption on both entry and exit.
      const entry = candles[entryIndex].open * (1 + (sign * slippagePct) / 100);
      if (!(entry > 0)) continue;

      const stopPrice = stopPriceFor(direction, entry, series, i, settings);
      const stopDistancePct = (Math.abs(entry - stopPrice) / entry) * 100;
      if (!(stopDistancePct > 0)) continue;
      const riskDistance = Math.abs(entry - stopPrice);
      const target1 =
        settings.takeProfitMode === "FIXED"
          ? entry * (1 + (sign * settings.fixedTarget1Pct) / 100)
          : entry + sign * riskDistance * params.target1R;
      const target2 =
        settings.takeProfitMode === "FIXED"
          ? entry * (1 + (sign * settings.fixedTarget2Pct) / 100)
          : entry + sign * riskDistance * params.target2R;
      const liquidationPrice = liquidationPriceFor(
        direction,
        entry,
        settings.leverage,
        costs.maintenanceMarginRate,
      );

      const returnAt = (price: number) => {
        // Exit fills slip against the position as well.
        const filled = price * (1 - (sign * slippagePct) / 100);
        return (sign * (filled - entry) * 100) / entry;
      };

      let remaining = 1;
      let realizedPct = 0;
      let activeStop = stopPrice;
      let tp1Filled = false;
      let exitReason: SimTrade["exitReason"] = "TIME";
      let exitIndex = Math.min(entryIndex + bars, candles.length - 1);
      let exitPrice = candles[exitIndex].close;
      let liquidated = false;
      let fills = 1;

      const lastIndex = Math.min(entryIndex + bars, candles.length - 1);
      for (let k = entryIndex; k <= lastIndex; k += 1) {
        const bar = candles[k];
        const adverse = direction === "LONG" ? bar.low : bar.high;
        const favorable = direction === "LONG" ? bar.high : bar.low;

        if (sign * (adverse - liquidationPrice) <= 0) {
          realizedPct += remaining * returnAt(liquidationPrice);
          remaining = 0;
          exitReason = "LIQUIDATION";
          exitIndex = k;
          exitPrice = liquidationPrice;
          liquidated = true;
          fills += 1;
          break;
        }

        // Within a single bar the true sequence is unknown, so a stop that is in
        // range is assumed to trigger before any target in the same bar.
        if (sign * (adverse - activeStop) <= 0) {
          realizedPct += remaining * returnAt(activeStop);
          remaining = 0;
          exitReason = tp1Filled ? "BREAKEVEN" : "STOP";
          exitIndex = k;
          exitPrice = activeStop;
          fills += 1;
          break;
        }

        if (!tp1Filled && sign * (favorable - target1) >= 0) {
          const fraction = Math.min(Math.max(params.target1Fraction, 0), 1);
          realizedPct += fraction * returnAt(target1);
          remaining -= fraction;
          tp1Filled = true;
          activeStop = entry;
          fills += 1;
          exitReason = "TP1";
          exitIndex = k;
          exitPrice = target1;
          if (remaining <= 0.0001) {
            remaining = 0;
            break;
          }
        }

        if (tp1Filled && remaining > 0 && sign * (favorable - target2) >= 0) {
          realizedPct += remaining * returnAt(target2);
          remaining = 0;
          exitReason = "TP2";
          exitIndex = k;
          exitPrice = target2;
          fills += 1;
          break;
        }
      }

      if (remaining > 0) {
        const closeBar = candles[lastIndex];
        realizedPct += remaining * returnAt(closeBar.close);
        exitReason = tp1Filled ? "TP1" : "TIME";
        exitIndex = lastIndex;
        exitPrice = closeBar.close;
        fills += 1;
      }

      const holdingBars = Math.max(1, exitIndex - entryIndex + 1);
      const holdingMinutes = holdingBars * barMinutes;
      const feeCostPct = feePct * fills;
      const fundingCostPct = fundingPct8h * (holdingMinutes / 480);
      const costPct = feeCostPct + fundingCostPct;
      const netNotionalReturnPct = realizedPct - costPct;

      trades.push({
        symbol,
        timeframe,
        strategy: strategyId,
        direction,
        entryTime: candles[entryIndex].openTime,
        exitTime: candles[exitIndex].openTime,
        entryPrice: entry,
        exitPrice,
        stopPrice,
        target1,
        target2,
        liquidationPrice,
        exitReason,
        holdingBars,
        holdingMinutes,
        stopDistancePct,
        priceReturnPct: realizedPct,
        feePct: feeCostPct,
        fundingPct: fundingCostPct,
        costPct,
        netNotionalReturnPct,
        rMultiple: netNotionalReturnPct / stopDistancePct,
        leverage: settings.leverage,
        liquidated,
        regime: regimeAt(series, i, volatilityBandAt(series, i)),
        volatility: volatilityBandAt(series, i),
        entryRsi: series.rsi[i],
        entryAtrPct: series.atrPct[i],
      });
      produced += 1;
      nextAvailable = exitIndex + 1;
    }
  }

  return trades;
}
