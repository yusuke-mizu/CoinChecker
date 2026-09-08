import { atrSeries, emaSeries, rsiSeries } from "@/lib/indicators";
import type { Candle } from "@/lib/types/market";

export { atrSeries };

/**
 * Causal indicator series for backtesting.
 *
 * Every element at index `i` is computable from `candles[0..i]` only. Reading
 * `series.x[i]` inside a bar loop therefore cannot leak future information.
 * Series named `prior*` additionally exclude bar `i` itself, so a breakout test
 * never compares a bar against a level that the same bar helped define.
 */
export type Series = {
  length: number;
  close: number[];
  high: number[];
  low: number[];
  volume: number[];
  ema20: Array<number | null>;
  ema50: Array<number | null>;
  ema200: Array<number | null>;
  emaFast: Array<number | null>;
  emaSlow: Array<number | null>;
  rsi: Array<number | null>;
  atr: Array<number | null>;
  atrPct: Array<number | null>;
  atrPctMedian: Array<number | null>;
  bbMid: Array<number | null>;
  bbUpper: Array<number | null>;
  bbLower: Array<number | null>;
  vwap: Array<number | null>;
  volumeRatio: Array<number | null>;
  stochK: Array<number | null>;
  priorHigh: Array<number | null>;
  priorLow: Array<number | null>;
  swingLow: Array<number | null>;
  swingHigh: Array<number | null>;
  return24: Array<number | null>;
  return8: Array<number | null>;
};

function nullArray(length: number): Array<number | null> {
  return new Array<number | null>(length).fill(null);
}

function movingStats(
  values: number[],
  period: number,
): { mean: Array<number | null>; stdDev: Array<number | null> } {
  const mean = nullArray(values.length);
  const stdDev = nullArray(values.length);
  let sum = 0;
  let sumSquares = 0;
  for (let i = 0; i < values.length; i += 1) {
    sum += values[i];
    sumSquares += values[i] * values[i];
    if (i >= period) {
      sum -= values[i - period];
      sumSquares -= values[i - period] * values[i - period];
    }
    if (i >= period - 1) {
      const average = sum / period;
      mean[i] = average;
      stdDev[i] = Math.sqrt(Math.max(0, sumSquares / period - average * average));
    }
  }
  return { mean, stdDev };
}

/** Rolling VWAP. Sessionless, so it stays well defined on perpetual 24h markets. */
function rollingVwap(candles: Candle[], period: number): Array<number | null> {
  const out = nullArray(candles.length);
  let priceVolume = 0;
  let volume = 0;
  const typical = candles.map((candle) => (candle.high + candle.low + candle.close) / 3);
  for (let i = 0; i < candles.length; i += 1) {
    priceVolume += typical[i] * candles[i].volume;
    volume += candles[i].volume;
    if (i >= period) {
      priceVolume -= typical[i - period] * candles[i - period].volume;
      volume -= candles[i - period].volume;
    }
    if (i >= period - 1 && volume > 0) out[i] = priceVolume / volume;
  }
  return out;
}

function priorExtreme(
  values: number[],
  period: number,
  pick: "max" | "min",
): Array<number | null> {
  const out = nullArray(values.length);
  for (let i = period; i < values.length; i += 1) {
    let best = values[i - period];
    for (let j = i - period + 1; j < i; j += 1) {
      if (pick === "max" ? values[j] > best : values[j] < best) best = values[j];
    }
    out[i] = best;
  }
  return out;
}

function rollingExtreme(
  values: number[],
  period: number,
  pick: "max" | "min",
): Array<number | null> {
  const out = nullArray(values.length);
  for (let i = period - 1; i < values.length; i += 1) {
    let best = values[i - period + 1];
    for (let j = i - period + 2; j <= i; j += 1) {
      if (pick === "max" ? values[j] > best : values[j] < best) best = values[j];
    }
    out[i] = best;
  }
  return out;
}

function trailingMedian(
  values: Array<number | null>,
  period: number,
): Array<number | null> {
  const out = nullArray(values.length);
  for (let i = period; i < values.length; i += 1) {
    const window: number[] = [];
    for (let j = i - period; j < i; j += 1) {
      const value = values[j];
      if (value != null) window.push(value);
    }
    if (window.length < period / 2) continue;
    window.sort((a, b) => a - b);
    out[i] = window[Math.floor(window.length / 2)];
  }
  return out;
}

function returnSeries(closes: number[], barsBack: number): Array<number | null> {
  const out = nullArray(closes.length);
  for (let i = barsBack; i < closes.length; i += 1) {
    const from = closes[i - barsBack];
    if (from > 0) out[i] = ((closes[i] - from) / from) * 100;
  }
  return out;
}

export function buildSeries(
  candles: Candle[],
  options: { emaFast: number; emaSlow: number; breakoutLookback: number },
): Series {
  const close = candles.map((candle) => candle.close);
  const high = candles.map((candle) => candle.high);
  const low = candles.map((candle) => candle.low);
  const volume = candles.map((candle) => candle.volume);

  const atr = atrSeries(candles);
  const atrPct = atr.map((value, index) =>
    value == null || !(close[index] > 0) ? null : (value / close[index]) * 100,
  );
  const bands = movingStats(close, 20);
  const volumeStats = movingStats(volume, 20);
  const stochHigh = rollingExtreme(high, 14, "max");
  const stochLow = rollingExtreme(low, 14, "min");

  return {
    length: candles.length,
    close,
    high,
    low,
    volume,
    ema20: emaSeries(close, 20),
    ema50: emaSeries(close, 50),
    ema200: emaSeries(close, 200),
    emaFast: emaSeries(close, options.emaFast),
    emaSlow: emaSeries(close, options.emaSlow),
    rsi: rsiSeries(close, 14),
    atr,
    atrPct,
    atrPctMedian: trailingMedian(atrPct, 96),
    bbMid: bands.mean,
    bbUpper: bands.mean.map((mean, index) => {
      const deviation = bands.stdDev[index];
      return mean == null || deviation == null ? null : mean + deviation * 2;
    }),
    bbLower: bands.mean.map((mean, index) => {
      const deviation = bands.stdDev[index];
      return mean == null || deviation == null ? null : mean - deviation * 2;
    }),
    vwap: rollingVwap(candles, 24),
    volumeRatio: volume.map((value, index) => {
      const average = volumeStats.mean[index];
      return average == null || average <= 0 ? null : value / average;
    }),
    stochK: close.map((value, index) => {
      const highest = stochHigh[index];
      const lowest = stochLow[index];
      if (highest == null || lowest == null || highest <= lowest) return null;
      return ((value - lowest) / (highest - lowest)) * 100;
    }),
    priorHigh: priorExtreme(high, options.breakoutLookback, "max"),
    priorLow: priorExtreme(low, options.breakoutLookback, "min"),
    swingHigh: priorExtreme(high, 10, "max"),
    swingLow: priorExtreme(low, 10, "min"),
    return24: returnSeries(close, 24),
    return8: returnSeries(close, 8),
  };
}

/** Bars needed before any strategy is allowed to trade. */
export const WARMUP_BARS = 210;
