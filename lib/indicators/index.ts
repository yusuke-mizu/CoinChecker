export function sma(values: number[], period: number): number | null {
  if (values.length < period) return null;
  const slice = values.slice(-period);
  const sum = slice.reduce((acc, v) => acc + v, 0);
  return sum / period;
}

export function emaSeries(values: number[], period: number): Array<number | null> {
  const out: Array<number | null> = Array(values.length).fill(null);
  if (values.length < period) return out;
  let sum = 0;
  for (let i = 0; i < period; i += 1) sum += values[i];
  let prev = sum / period;
  out[period - 1] = prev;
  const k = 2 / (period + 1);
  for (let i = period; i < values.length; i += 1) {
    prev = values[i] * k + prev * (1 - k);
    out[i] = prev;
  }
  return out;
}

export function lastEma(values: number[], period: number): number | null {
  const series = emaSeries(values, period);
  const value = series[series.length - 1];
  return value ?? null;
}

export function rsiSeries(closes: number[], period = 14): Array<number | null> {
  const out: Array<number | null> = Array(closes.length).fill(null);
  if (closes.length < period + 1) return out;
  let gain = 0;
  let loss = 0;
  for (let i = 1; i <= period; i += 1) {
    const diff = closes[i] - closes[i - 1];
    if (diff >= 0) gain += diff;
    else loss -= diff;
  }
  let avgGain = gain / period;
  let avgLoss = loss / period;
  const rsiAt = (g: number, l: number) => (l === 0 ? 100 : 100 - 100 / (1 + g / l));
  out[period] = rsiAt(avgGain, avgLoss);
  for (let i = period + 1; i < closes.length; i += 1) {
    const diff = closes[i] - closes[i - 1];
    const g = diff > 0 ? diff : 0;
    const l = diff < 0 ? -diff : 0;
    avgGain = (avgGain * (period - 1) + g) / period;
    avgLoss = (avgLoss * (period - 1) + l) / period;
    out[i] = rsiAt(avgGain, avgLoss);
  }
  return out;
}

export function rsiDivergence(
  closes: number[],
  lookback = 40,
): "bearish" | "bullish" | "none" {
  const rsi = rsiSeries(closes);
  const start = Math.max(0, closes.length - lookback);
  const price = closes.slice(start);
  const osc = rsi.slice(start).map((v) => v ?? Number.NaN);
  if (price.length < 16) return "none";
  const mid = Math.floor(price.length / 2);
  const firstP = price.slice(0, mid);
  const lastP = price.slice(mid);
  const firstR = osc.slice(0, mid).filter((v) => Number.isFinite(v));
  const lastR = osc.slice(mid).filter((v) => Number.isFinite(v));
  if (!firstR.length || !lastR.length) return "none";
  const hh = Math.max(...lastP) > Math.max(...firstP);
  const lh = Math.max(...lastP) < Math.max(...firstP);
  const rsiLowerHigh = Math.max(...lastR) < Math.max(...firstR);
  const rsiHigherLow = Math.min(...lastR) > Math.min(...firstR);
  const ll = Math.min(...lastP) < Math.min(...firstP);
  const hl = Math.min(...lastP) > Math.min(...firstP);
  if (hh && rsiLowerHigh) return "bearish";
  if (ll && rsiHigherLow) return "bullish";
  if (lh && rsiHigherLow && hl) return "bullish";
  return "none";
}

export function rsiWilder(closes: number[], period = 14): number | null {
  if (closes.length < period + 1) return null;
  let gain = 0;
  let loss = 0;
  for (let i = 1; i <= period; i += 1) {
    const diff = closes[i] - closes[i - 1];
    if (diff >= 0) gain += diff;
    else loss -= diff;
  }
  let avgGain = gain / period;
  let avgLoss = loss / period;
  for (let i = period + 1; i < closes.length; i += 1) {
    const diff = closes[i] - closes[i - 1];
    const g = diff > 0 ? diff : 0;
    const l = diff < 0 ? -diff : 0;
    avgGain = (avgGain * (period - 1) + g) / period;
    avgLoss = (avgLoss * (period - 1) + l) / period;
  }
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

export type MacdResult = {
  macd: number | null;
  signal: number | null;
  hist: number | null;
};

export function macd(closes: number[], fast = 12, slow = 26, signal = 9): MacdResult {
  if (closes.length < slow + signal) {
    return { macd: null, signal: null, hist: null };
  }
  const fastEma = emaSeries(closes, fast);
  const slowEma = emaSeries(closes, slow);
  const macdLine: number[] = [];
  for (let i = 0; i < closes.length; i += 1) {
    const f = fastEma[i];
    const s = slowEma[i];
    if (f == null || s == null) continue;
    macdLine.push(f - s);
  }
  if (macdLine.length < signal) {
    return { macd: null, signal: null, hist: null };
  }
  const signalSeries = emaSeries(macdLine, signal);
  const macdLast = macdLine[macdLine.length - 1];
  const signalLast = signalSeries[signalSeries.length - 1];
  if (macdLast == null || signalLast == null) {
    return { macd: null, signal: null, hist: null };
  }
  return {
    macd: macdLast,
    signal: signalLast,
    hist: macdLast - signalLast,
  };
}

/** EMA over a series that may have leading gaps, preserving index alignment. */
function emaOfSparse(values: Array<number | null>, period: number): Array<number | null> {
  const out: Array<number | null> = Array(values.length).fill(null);
  let seeded = 0;
  let seedSum = 0;
  let previous: number | null = null;
  const k = 2 / (period + 1);
  for (let i = 0; i < values.length; i += 1) {
    const value = values[i];
    if (value == null) continue;
    if (previous == null) {
      seeded += 1;
      seedSum += value;
      if (seeded === period) {
        previous = seedSum / period;
        out[i] = previous;
      }
    } else {
      previous = value * k + previous * (1 - k);
      out[i] = previous;
    }
  }
  return out;
}

/**
 * MACD as causal series. Unlike `macd()`, which compacts away the warmup nulls,
 * these arrays stay aligned to the candle index so they can be read inside a
 * historical loop without shifting the timeline.
 */
export function macdSeries(
  closes: number[],
  fast = 12,
  slow = 26,
  signalPeriod = 9,
): {
  macd: Array<number | null>;
  signal: Array<number | null>;
  hist: Array<number | null>;
} {
  const fastEma = emaSeries(closes, fast);
  const slowEma = emaSeries(closes, slow);
  const macdLine: Array<number | null> = closes.map((_, index) => {
    const f = fastEma[index];
    const s = slowEma[index];
    return f == null || s == null ? null : f - s;
  });
  const signal = emaOfSparse(macdLine, signalPeriod);
  return {
    macd: macdLine,
    signal,
    hist: macdLine.map((value, index) => {
      const line = signal[index];
      return value == null || line == null ? null : value - line;
    }),
  };
}

/** Wilder ADX / +DI / -DI as causal series, aligned to the candle index. */
export function adxSeries(
  highs: number[],
  lows: number[],
  closes: number[],
  period = 14,
): {
  adx: Array<number | null>;
  plusDi: Array<number | null>;
  minusDi: Array<number | null>;
} {
  const n = Math.min(highs.length, lows.length, closes.length);
  const adx: Array<number | null> = Array(n).fill(null);
  const plusDi: Array<number | null> = Array(n).fill(null);
  const minusDi: Array<number | null> = Array(n).fill(null);
  if (n < period * 2 + 1) return { adx, plusDi, minusDi };

  const tr: number[] = Array(n).fill(0);
  const plusDm: number[] = Array(n).fill(0);
  const minusDm: number[] = Array(n).fill(0);
  for (let i = 1; i < n; i += 1) {
    const upMove = highs[i] - highs[i - 1];
    const downMove = lows[i - 1] - lows[i];
    plusDm[i] = upMove > downMove && upMove > 0 ? upMove : 0;
    minusDm[i] = downMove > upMove && downMove > 0 ? downMove : 0;
    tr[i] = Math.max(
      highs[i] - lows[i],
      Math.abs(highs[i] - closes[i - 1]),
      Math.abs(lows[i] - closes[i - 1]),
    );
  }

  let smoothTr = 0;
  let smoothPlus = 0;
  let smoothMinus = 0;
  for (let i = 1; i <= period; i += 1) {
    smoothTr += tr[i];
    smoothPlus += plusDm[i];
    smoothMinus += minusDm[i];
  }

  const dx: Array<number | null> = Array(n).fill(null);
  const dxAt = (index: number) => {
    if (!(smoothTr > 0)) return;
    const plus = (100 * smoothPlus) / smoothTr;
    const minus = (100 * smoothMinus) / smoothTr;
    plusDi[index] = plus;
    minusDi[index] = minus;
    const total = plus + minus;
    dx[index] = total === 0 ? 0 : (100 * Math.abs(plus - minus)) / total;
  };
  dxAt(period);
  for (let i = period + 1; i < n; i += 1) {
    smoothTr = smoothTr - smoothTr / period + tr[i];
    smoothPlus = smoothPlus - smoothPlus / period + plusDm[i];
    smoothMinus = smoothMinus - smoothMinus / period + minusDm[i];
    dxAt(i);
  }

  // ADX seeds with the mean of the first `period` DX values, then Wilder smooths.
  const seedEnd = period * 2 - 1;
  let seedSum = 0;
  let seedCount = 0;
  for (let i = period; i <= seedEnd && i < n; i += 1) {
    const value = dx[i];
    if (value != null) {
      seedSum += value;
      seedCount += 1;
    }
  }
  if (seedCount === 0) return { adx, plusDi, minusDi };
  let value = seedSum / seedCount;
  if (seedEnd < n) adx[seedEnd] = value;
  for (let i = seedEnd + 1; i < n; i += 1) {
    const current = dx[i];
    if (current == null) continue;
    value = (value * (period - 1) + current) / period;
    adx[i] = value;
  }
  return { adx, plusDi, minusDi };
}

export type AdxResult = {
  adx: number | null;
  plusDi: number | null;
  minusDi: number | null;
};

export function adx(highs: number[], lows: number[], closes: number[], period = 14): AdxResult {
  const n = Math.min(highs.length, lows.length, closes.length);
  if (n < period * 2) {
    return { adx: null, plusDi: null, minusDi: null };
  }

  const tr: number[] = [];
  const plusDm: number[] = [];
  const minusDm: number[] = [];
  for (let i = 1; i < n; i += 1) {
    const upMove = highs[i] - highs[i - 1];
    const downMove = lows[i - 1] - lows[i];
    plusDm.push(upMove > downMove && upMove > 0 ? upMove : 0);
    minusDm.push(downMove > upMove && downMove > 0 ? downMove : 0);
    tr.push(
      Math.max(
        highs[i] - lows[i],
        Math.abs(highs[i] - closes[i - 1]),
        Math.abs(lows[i] - closes[i - 1]),
      ),
    );
  }

  const smooth = (arr: number[], p: number): number[] => {
    const out: number[] = [];
    let prev = arr.slice(0, p).reduce((a, b) => a + b, 0);
    out.push(prev);
    for (let i = p; i < arr.length; i += 1) {
      prev = prev - prev / p + arr[i];
      out.push(prev);
    }
    return out;
  };

  const trs = smooth(tr, period);
  const pDm = smooth(plusDm, period);
  const mDm = smooth(minusDm, period);
  const dx: number[] = [];
  for (let i = 0; i < trs.length; i += 1) {
    const plusDi = trs[i] === 0 ? 0 : (100 * pDm[i]) / trs[i];
    const minusDi = trs[i] === 0 ? 0 : (100 * mDm[i]) / trs[i];
    const denom = plusDi + minusDi;
    dx.push(denom === 0 ? 0 : (100 * Math.abs(plusDi - minusDi)) / denom);
  }
  if (dx.length < period) {
    return { adx: null, plusDi: null, minusDi: null };
  }

  let adxValue = dx.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < dx.length; i += 1) {
    adxValue = (adxValue * (period - 1) + dx[i]) / period;
  }

  const lastTr = trs[trs.length - 1];
  return {
    adx: adxValue,
    plusDi: lastTr === 0 ? 0 : (100 * pDm[pDm.length - 1]) / lastTr,
    minusDi: lastTr === 0 ? 0 : (100 * mDm[mDm.length - 1]) / lastTr,
  };
}

/** Wilder ATR as a causal series: index i uses candles up to and including i. */
export function atrSeries(
  candles: Array<{ high: number; low: number; close: number }>,
  period = 14,
): Array<number | null> {
  const out: Array<number | null> = Array(candles.length).fill(null);
  if (candles.length <= period) return out;
  const tr: number[] = Array(candles.length).fill(0);
  for (let i = 1; i < candles.length; i += 1) {
    const previousClose = candles[i - 1].close;
    tr[i] = Math.max(
      candles[i].high - candles[i].low,
      Math.abs(candles[i].high - previousClose),
      Math.abs(candles[i].low - previousClose),
    );
  }
  let sum = 0;
  for (let i = 1; i <= period; i += 1) sum += tr[i];
  let value = sum / period;
  out[period] = value;
  for (let i = period + 1; i < candles.length; i += 1) {
    value = (value * (period - 1) + tr[i]) / period;
    out[i] = value;
  }
  return out;
}

export function volumeRatio(volumes: number[], period = 20): number | null {
  if (volumes.length < period + 1) return null;
  const current = volumes[volumes.length - 1];
  const avg = sma(volumes.slice(0, -1), period);
  if (avg == null || avg === 0) return null;
  return current / avg;
}

export type StructureLabel = "HH_HL" | "LH_LL" | "MIXED" | "UNKNOWN";

export function priceStructure(highs: number[], lows: number[], lookback = 8): StructureLabel {
  if (highs.length < lookback * 2 || lows.length < lookback * 2) return "UNKNOWN";
  const recentHigh = Math.max(...highs.slice(-lookback));
  const prevHigh = Math.max(...highs.slice(-lookback * 2, -lookback));
  const recentLow = Math.min(...lows.slice(-lookback));
  const prevLow = Math.min(...lows.slice(-lookback * 2, -lookback));
  const hh = recentHigh > prevHigh;
  const hl = recentLow > prevLow;
  const lh = recentHigh < prevHigh;
  const ll = recentLow < prevLow;
  if (hh && hl) return "HH_HL";
  if (lh && ll) return "LH_LL";
  return "MIXED";
}
