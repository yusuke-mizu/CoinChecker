import { adxSeries, atrSeries, emaSeries, macdSeries, rsiSeries } from "@/lib/indicators";
import type { Candle } from "@/lib/types/market";

/**
 * Causal indicator series for feature extraction.
 *
 * Every array is aligned to the candle index and element `i` is computable from
 * `candles[0..i]` only. `priorHigh` / `priorLow` additionally exclude bar `i`
 * itself so a "distance to resistance" feature never uses a level that the
 * current bar helped create.
 */
export type FeatureSeries = {
  length: number;
  close: number[];
  high: number[];
  low: number[];
  volume: number[];
  ema20: Array<number | null>;
  ema50: Array<number | null>;
  ema200: Array<number | null>;
  rsi: Array<number | null>;
  macd: Array<number | null>;
  macdSignal: Array<number | null>;
  macdHist: Array<number | null>;
  adx: Array<number | null>;
  plusDi: Array<number | null>;
  minusDi: Array<number | null>;
  atr: Array<number | null>;
  atrPct: Array<number | null>;
  atrPctMedian: Array<number | null>;
  /** Per-bar log-return standard deviation, the scale used to size barriers. */
  sigmaBar: Array<number | null>;
  bbMid: Array<number | null>;
  bbUpper: Array<number | null>;
  bbLower: Array<number | null>;
  bbWidthPct: Array<number | null>;
  percentB: Array<number | null>;
  vwap: Array<number | null>;
  volumeZ: Array<number | null>;
  volumeRatio: Array<number | null>;
  /** Cumulative taker delta, null when the venue omits taker volume. */
  cvd: Array<number | null>;
  priorHigh: Array<number | null>;
  priorLow: Array<number | null>;
  rangeHigh: Array<number | null>;
  rangeLow: Array<number | null>;
  structureUp: Array<number | null>;
  structureDown: Array<number | null>;
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

/** Rolling VWAP. Sessionless, so it stays defined on 24h perpetual markets. */
function rollingVwap(candles: Candle[], period: number): Array<number | null> {
  const out = nullArray(candles.length);
  let priceVolume = 0;
  let volume = 0;
  for (let i = 0; i < candles.length; i += 1) {
    const typical = (candles[i].high + candles[i].low + candles[i].close) / 3;
    priceVolume += typical * candles[i].volume;
    volume += candles[i].volume;
    if (i >= period) {
      const old = candles[i - period];
      priceVolume -= ((old.high + old.low + old.close) / 3) * old.volume;
      volume -= old.volume;
    }
    if (i >= period - 1 && volume > 0) out[i] = priceVolume / volume;
  }
  return out;
}

/** Monotonic-deque rolling extreme. `exclusive` drops bar i from its own window. */
function rollingExtreme(
  values: number[],
  period: number,
  pick: "max" | "min",
  exclusive = false,
): Array<number | null> {
  const out = nullArray(values.length);
  const deque: number[] = [];
  const better = (a: number, b: number) => (pick === "max" ? a >= b : a <= b);
  for (let i = 0; i < values.length; i += 1) {
    if (exclusive) {
      // Emit before pushing bar i, so the window covers [i-period, i-1].
      while (deque.length && deque[0] < i - period) deque.shift();
      if (i >= period) out[i] = values[deque[0]];
    }
    while (deque.length && better(values[i], values[deque[deque.length - 1]])) deque.pop();
    deque.push(i);
    if (!exclusive) {
      while (deque.length && deque[0] <= i - period) deque.shift();
      if (i >= period - 1) out[i] = values[deque[0]];
    }
  }
  return out;
}

function trailingMedian(values: Array<number | null>, period: number): Array<number | null> {
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

function sigmaSeries(closes: number[], period: number): Array<number | null> {
  const logReturns = nullArray(closes.length);
  for (let i = 1; i < closes.length; i += 1) {
    if (closes[i] > 0 && closes[i - 1] > 0) {
      logReturns[i] = Math.log(closes[i] / closes[i - 1]);
    }
  }
  const out = nullArray(closes.length);
  let sum = 0;
  let sumSquares = 0;
  let count = 0;
  for (let i = 0; i < closes.length; i += 1) {
    const value = logReturns[i];
    if (value != null) {
      sum += value;
      sumSquares += value * value;
      count += 1;
    }
    if (i >= period) {
      const old = logReturns[i - period];
      if (old != null) {
        sum -= old;
        sumSquares -= old * old;
        count -= 1;
      }
    }
    if (count >= Math.max(10, period / 2)) {
      const average = sum / count;
      out[i] = Math.sqrt(Math.max(1e-12, sumSquares / count - average * average));
    }
  }
  return out;
}

/** Higher-high / higher-low structure, comparing the last `lookback` bars to the previous block. */
function structureSeries(
  highs: number[],
  lows: number[],
  lookback: number,
): { up: Array<number | null>; down: Array<number | null> } {
  const recentHigh = rollingExtreme(highs, lookback, "max");
  const recentLow = rollingExtreme(lows, lookback, "min");
  const up = nullArray(highs.length);
  const down = nullArray(highs.length);
  for (let i = lookback * 2 - 1; i < highs.length; i += 1) {
    const rh = recentHigh[i];
    const rl = recentLow[i];
    const ph = recentHigh[i - lookback];
    const pl = recentLow[i - lookback];
    if (rh == null || rl == null || ph == null || pl == null) continue;
    up[i] = rh > ph && rl > pl ? 1 : 0;
    down[i] = rh < ph && rl < pl ? 1 : 0;
  }
  return { up, down };
}

export function buildFeatureSeries(candles: Candle[]): FeatureSeries {
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
  const macd = macdSeries(close);
  const directional = adxSeries(high, low, close);
  const structure = structureSeries(high, low, 8);

  let cvdRunning = 0;
  let cvdBroken = false;
  const cvd = candles.map((candle) => {
    if (cvdBroken || candle.takerBuyVolume == null) {
      cvdBroken = true;
      return null;
    }
    cvdRunning += 2 * candle.takerBuyVolume - candle.volume;
    return cvdRunning;
  });

  return {
    length: candles.length,
    close,
    high,
    low,
    volume,
    ema20: emaSeries(close, 20),
    ema50: emaSeries(close, 50),
    ema200: emaSeries(close, 200),
    rsi: rsiSeries(close, 14),
    macd: macd.macd,
    macdSignal: macd.signal,
    macdHist: macd.hist,
    adx: directional.adx,
    plusDi: directional.plusDi,
    minusDi: directional.minusDi,
    atr,
    atrPct,
    atrPctMedian: trailingMedian(atrPct, 96),
    sigmaBar: sigmaSeries(close, 96),
    bbMid: bands.mean,
    bbUpper: bands.mean.map((mean, index) => {
      const deviation = bands.stdDev[index];
      return mean == null || deviation == null ? null : mean + deviation * 2;
    }),
    bbLower: bands.mean.map((mean, index) => {
      const deviation = bands.stdDev[index];
      return mean == null || deviation == null ? null : mean - deviation * 2;
    }),
    bbWidthPct: bands.mean.map((mean, index) => {
      const deviation = bands.stdDev[index];
      return mean == null || deviation == null || !(mean > 0)
        ? null
        : ((deviation * 4) / mean) * 100;
    }),
    percentB: close.map((value, index) => {
      const mean = bands.mean[index];
      const deviation = bands.stdDev[index];
      if (mean == null || deviation == null || deviation <= 0) return null;
      return (value - (mean - deviation * 2)) / (deviation * 4);
    }),
    vwap: rollingVwap(candles, 24),
    volumeZ: volume.map((value, index) => {
      const mean = volumeStats.mean[index];
      const deviation = volumeStats.stdDev[index];
      if (mean == null || deviation == null || deviation <= 0) return null;
      return (value - mean) / deviation;
    }),
    volumeRatio: volume.map((value, index) => {
      const mean = volumeStats.mean[index];
      return mean == null || mean <= 0 ? null : value / mean;
    }),
    cvd,
    priorHigh: rollingExtreme(high, 24, "max", true),
    priorLow: rollingExtreme(low, 24, "min", true),
    rangeHigh: rollingExtreme(high, 96, "max"),
    rangeLow: rollingExtreme(low, 96, "min"),
    structureUp: structure.up,
    structureDown: structure.down,
  };
}

/** Bars of history required before any feature vector is considered valid. */
export const FEATURE_WARMUP_BARS = 210;
