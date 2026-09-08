import type { Candle } from "@/lib/types/market";
import type { MarketRegime } from "@/lib/types/prediction";
import { buildFeatureSeries, FEATURE_WARMUP_BARS, type FeatureSeries } from "./feature-series";
import { resample, type Resampled } from "./resample";

/**
 * Feature extraction.
 *
 * Two rules hold everywhere in this file:
 *
 * 1. Causality. A feature at bar `i` reads `candles[0..i]` only. Higher
 *    timeframes go through `Resampled.indexFor`, which points at the last
 *    *closed* aggregate bar, so a 4h feature never contains the running 4h bar.
 * 2. Scale freedom. Every feature is expressed in ATR units, percentages,
 *    z-scores or bounded ratios, never in raw price. That is what lets one
 *    pooled model train across symbols with very different price levels and
 *    volatility, which is how thin-history altcoins borrow strength from the
 *    rest of the market.
 */

export const STATE_FEATURE_NAMES = [
  // 15m base timeframe
  "f15_ema20_dist",
  "f15_ema50_dist",
  "f15_ema200_dist",
  "f15_ema20_50",
  "f15_ema50_200",
  "f15_rsi",
  "f15_rsi_delta",
  "f15_macd_hist",
  "f15_macd_line",
  "f15_adx",
  "f15_di_diff",
  "f15_atr_regime",
  "f15_bb_width",
  "f15_percent_b",
  "f15_vwap_dist",
  "f15_volume_z",
  "f15_volume_ratio",
  "f15_structure",
  "f15_range_pos",
  "f15_res_dist",
  "f15_sup_dist",
  "f15_ret1",
  "f15_ret2",
  "f15_ret4",
  "f15_ret8",
  "f15_ret16",
  "f15_cvd_delta4",
  "f15_cvd_delta16",
  "f15_cvd_available",
  // 1h
  "h1_ema20_dist",
  "h1_ema20_50",
  "h1_ema50_200",
  "h1_rsi",
  "h1_macd_hist",
  "h1_adx",
  "h1_di_diff",
  "h1_atr_regime",
  "h1_percent_b",
  "h1_vwap_dist",
  "h1_range_pos",
  "h1_ret4",
  // 4h. No EMA200-derived feature here: at 4h it needs 3,200 base bars, far
  // more than a live scan fetches, and a feature that is real in training but
  // imputed at prediction time is train/serve skew.
  "h4_ema20_50",
  "h4_rsi",
  "h4_macd_hist",
  "h4_adx",
  "h4_di_diff",
  "h4_ret4",
  // BTC / market regime
  "btc_ret4",
  "btc_ret16",
  "btc_ret96",
  "btc_rsi",
  "btc_trend",
  "btc_atr_regime",
  "corr_btc",
  "regime_bull",
  "regime_bear",
  "regime_highvol",
  "regime_lowvol",
  "regime_panic",
  "regime_recovery",
] as const;

/**
 * Barrier geometry. Distances are divided by the horizon's expected move
 * (sigma * sqrt(bars)), which is the quantity a first-passage probability
 * actually depends on. Expressing barriers this way lets a single model cover
 * every target/stop/horizon combination instead of training 70 separate ones.
 */
export const BARRIER_FEATURE_NAMES = [
  "bar_target_sigma",
  "bar_stop_sigma",
  "bar_log_horizon",
  "bar_target_over_stop",
  "bar_prior_target",
  "bar_prior_stop",
] as const;

export const FEATURE_NAMES: string[] = [...STATE_FEATURE_NAMES, ...BARRIER_FEATURE_NAMES];
export const STATE_FEATURE_COUNT = STATE_FEATURE_NAMES.length;
export const BARRIER_FEATURE_COUNT = BARRIER_FEATURE_NAMES.length;
export const FEATURE_COUNT = FEATURE_NAMES.length;

export type SymbolContext = {
  symbol: string;
  candles: Candle[];
  base: FeatureSeries;
  hour: { series: FeatureSeries; map: Resampled };
  fourHour: { series: FeatureSeries; map: Resampled };
  logReturns: Array<number | null>;
};

export type MarketContext = {
  series: FeatureSeries;
  logReturns: Array<number | null>;
  regimes: MarketRegime[];
  /** openTime -> index, for aligning a symbol bar to the BTC bar of that minute. */
  indexByTime: Map<number, number>;
};

function logReturnSeries(closes: number[]): Array<number | null> {
  const out: Array<number | null> = Array(closes.length).fill(null);
  for (let i = 1; i < closes.length; i += 1) {
    if (closes[i] > 0 && closes[i - 1] > 0) out[i] = Math.log(closes[i] / closes[i - 1]);
  }
  return out;
}

export function buildSymbolContext(symbol: string, candles: Candle[]): SymbolContext {
  const hourMap = resample(candles, 4);
  const fourHourMap = resample(candles, 16);
  return {
    symbol,
    candles,
    base: buildFeatureSeries(candles),
    hour: { series: buildFeatureSeries(hourMap.candles), map: hourMap },
    fourHour: { series: buildFeatureSeries(fourHourMap.candles), map: fourHourMap },
    logReturns: logReturnSeries(candles.map((candle) => candle.close)),
  };
}

export function classifyRegime(series: FeatureSeries, i: number): MarketRegime {
  const atrPct = series.atrPct[i];
  const median = series.atrPctMedian[i];
  const atrRegime = atrPct != null && median != null && median > 0 ? atrPct / median : 1;
  const ret = (bars: number) => {
    if (i < bars) return 0;
    const from = series.close[i - bars];
    return from > 0 ? ((series.close[i] - from) / from) * 100 : 0;
  };
  const ret16 = ret(16);
  const ret96 = ret(96);
  const ema20 = series.ema20[i];
  const ema50 = series.ema50[i];
  const ema200 = series.ema200[i];

  if (atrRegime > 1.7 && ret16 < -2.5) return "PANIC";
  if (atrRegime > 1.5 && ret96 < -3 && ret16 > 1.5) return "RECOVERY";
  if (atrRegime > 1.6) return "HIGH_VOLATILITY";
  if (atrRegime < 0.6) return "LOW_VOLATILITY";
  if (ema20 != null && ema50 != null && ema200 != null) {
    if (ema20 > ema50 && ema50 > ema200 && ret96 > 0) return "BULL";
    if (ema20 < ema50 && ema50 < ema200 && ret96 < 0) return "BEAR";
  }
  return "NORMAL";
}

export function buildMarketContext(btcCandles: Candle[]): MarketContext {
  const series = buildFeatureSeries(btcCandles);
  const indexByTime = new Map<number, number>();
  btcCandles.forEach((candle, index) => indexByTime.set(candle.openTime, index));
  const regimes = btcCandles.map((_, index) => classifyRegime(series, index));
  return {
    series,
    logReturns: logReturnSeries(series.close),
    regimes,
    indexByTime,
  };
}

function clip(value: number, limit: number): number {
  if (!Number.isFinite(value)) return 0;
  return value < -limit ? -limit : value > limit ? limit : value;
}

function ret(series: FeatureSeries, i: number, bars: number): number | null {
  if (i < bars) return null;
  const from = series.close[i - bars];
  if (!(from > 0)) return null;
  return ((series.close[i] - from) / from) * 100;
}

/** Return in ATR units, so a 1% move on a calm coin outranks 1% on a wild one. */
function retNormalised(series: FeatureSeries, i: number, bars: number): number | null {
  const value = ret(series, i, bars);
  const atrPct = series.atrPct[i];
  if (value == null || atrPct == null || atrPct <= 0) return null;
  return clip(value / atrPct, 8);
}

function distanceInAtr(price: number, level: number | null, atr: number | null): number | null {
  if (level == null || atr == null || atr <= 0) return null;
  return clip((price - level) / atr, 10);
}

function rangePosition(series: FeatureSeries, i: number): number | null {
  const high = series.rangeHigh[i];
  const low = series.rangeLow[i];
  if (high == null || low == null || high <= low) return null;
  return (series.close[i] - low) / (high - low) - 0.5;
}

function cvdDelta(series: FeatureSeries, i: number, bars: number): number | null {
  if (i < bars) return null;
  const now = series.cvd[i];
  const then = series.cvd[i - bars];
  if (now == null || then == null) return null;
  // Normalise by traded volume over the window so it is comparable across symbols.
  let volume = 0;
  for (let j = i - bars + 1; j <= i; j += 1) volume += series.volume[j];
  if (!(volume > 0)) return null;
  return clip((now - then) / volume, 1);
}

function rollingCorrelation(
  a: Array<number | null>,
  aIndex: number,
  b: Array<number | null>,
  bIndex: number,
  window: number,
): number | null {
  if (aIndex < window || bIndex < window) return null;
  let sumA = 0;
  let sumB = 0;
  let sumAA = 0;
  let sumBB = 0;
  let sumAB = 0;
  let count = 0;
  for (let k = 0; k < window; k += 1) {
    const x = a[aIndex - k];
    const y = b[bIndex - k];
    if (x == null || y == null) continue;
    sumA += x;
    sumB += y;
    sumAA += x * x;
    sumBB += y * y;
    sumAB += x * y;
    count += 1;
  }
  if (count < window / 2) return null;
  const covariance = sumAB / count - (sumA / count) * (sumB / count);
  const varianceA = sumAA / count - (sumA / count) ** 2;
  const varianceB = sumBB / count - (sumB / count) ** 2;
  if (!(varianceA > 0) || !(varianceB > 0)) return null;
  return clip(covariance / Math.sqrt(varianceA * varianceB), 1);
}

function atrRegime(series: FeatureSeries, i: number): number | null {
  const atrPct = series.atrPct[i];
  const median = series.atrPctMedian[i];
  if (atrPct == null || median == null || median <= 0) return null;
  return clip(atrPct / median - 1, 4);
}

/**
 * State features at bar `i`. Returns null when the bar lacks the mandatory
 * price history; optional inputs (taker volume, BTC alignment) fall back to a
 * neutral value paired with an availability flag rather than dropping the row.
 */
export function extractStateFeatures(
  context: SymbolContext,
  i: number,
  market: MarketContext | null,
): Float64Array | null {
  const base = context.base;
  if (i < FEATURE_WARMUP_BARS || i >= base.length) return null;

  const close = base.close[i];
  const atr = base.atr[i];
  const atrPct = base.atrPct[i];
  if (!(close > 0) || atr == null || atr <= 0 || atrPct == null || atrPct <= 0) return null;

  const rsi = base.rsi[i];
  const macdHist = base.macdHist[i];
  const adx = base.adx[i];
  if (rsi == null || macdHist == null || adx == null) return null;

  const out = new Float64Array(STATE_FEATURE_COUNT);
  let k = 0;
  const push = (value: number | null, fallback = 0) => {
    out[k] = value == null || !Number.isFinite(value) ? fallback : value;
    k += 1;
  };

  // --- 15m ---
  push(distanceInAtr(close, base.ema20[i], atr));
  push(distanceInAtr(close, base.ema50[i], atr));
  push(distanceInAtr(close, base.ema200[i], atr));
  push(
    base.ema20[i] != null && base.ema50[i] != null
      ? clip((base.ema20[i]! - base.ema50[i]!) / atr, 10)
      : null,
  );
  push(
    base.ema50[i] != null && base.ema200[i] != null
      ? clip((base.ema50[i]! - base.ema200[i]!) / atr, 10)
      : null,
  );
  push((rsi - 50) / 50);
  push(base.rsi[i - 4] != null ? clip((rsi - base.rsi[i - 4]!) / 50, 2) : null);
  push(clip(macdHist / atr, 6));
  push(base.macd[i] != null ? clip(base.macd[i]! / atr, 8) : null);
  push(adx / 100);
  push(
    base.plusDi[i] != null && base.minusDi[i] != null
      ? (base.plusDi[i]! - base.minusDi[i]!) / 100
      : null,
  );
  push(atrRegime(base, i));
  push(base.bbWidthPct[i] != null ? clip(base.bbWidthPct[i]! / atrPct, 20) : null);
  push(base.percentB[i] != null ? clip(base.percentB[i]! - 0.5, 2) : null);
  push(distanceInAtr(close, base.vwap[i], atr));
  push(base.volumeZ[i] != null ? clip(base.volumeZ[i]!, 6) : null);
  push(base.volumeRatio[i] != null ? clip(Math.log(Math.max(0.05, base.volumeRatio[i]!)), 3) : null);
  push(
    base.structureUp[i] != null && base.structureDown[i] != null
      ? base.structureUp[i]! - base.structureDown[i]!
      : null,
  );
  push(rangePosition(base, i));
  push(
    base.priorHigh[i] != null ? clip(Math.max(0, base.priorHigh[i]! - close) / atr, 10) : null,
    10,
  );
  push(base.priorLow[i] != null ? clip(Math.max(0, close - base.priorLow[i]!) / atr, 10) : null, 10);
  push(retNormalised(base, i, 1));
  push(retNormalised(base, i, 2));
  push(retNormalised(base, i, 4));
  push(retNormalised(base, i, 8));
  push(retNormalised(base, i, 16));
  const cvd4 = cvdDelta(base, i, 4);
  const cvd16 = cvdDelta(base, i, 16);
  push(cvd4);
  push(cvd16);
  push(cvd4 == null && cvd16 == null ? 0 : 1);

  // --- 1h (last closed aggregate bar) ---
  const h1 = context.hour.series;
  const h1i = context.hour.map.indexFor[i];
  const h1Atr = h1i >= 0 ? h1.atr[h1i] : null;
  if (h1i >= 0 && h1Atr != null && h1Atr > 0) {
    push(distanceInAtr(h1.close[h1i], h1.ema20[h1i], h1Atr));
    push(
      h1.ema20[h1i] != null && h1.ema50[h1i] != null
        ? clip((h1.ema20[h1i]! - h1.ema50[h1i]!) / h1Atr, 10)
        : null,
    );
    push(
      h1.ema50[h1i] != null && h1.ema200[h1i] != null
        ? clip((h1.ema50[h1i]! - h1.ema200[h1i]!) / h1Atr, 10)
        : null,
    );
    push(h1.rsi[h1i] != null ? (h1.rsi[h1i]! - 50) / 50 : null);
    push(h1.macdHist[h1i] != null ? clip(h1.macdHist[h1i]! / h1Atr, 6) : null);
    push(h1.adx[h1i] != null ? h1.adx[h1i]! / 100 : null);
    push(
      h1.plusDi[h1i] != null && h1.minusDi[h1i] != null
        ? (h1.plusDi[h1i]! - h1.minusDi[h1i]!) / 100
        : null,
    );
    push(atrRegime(h1, h1i));
    push(h1.percentB[h1i] != null ? clip(h1.percentB[h1i]! - 0.5, 2) : null);
    push(distanceInAtr(h1.close[h1i], h1.vwap[h1i], h1Atr));
    push(rangePosition(h1, h1i));
    push(retNormalised(h1, h1i, 4));
  } else {
    for (let j = 0; j < 12; j += 1) push(null);
  }

  // --- 4h (last closed aggregate bar) ---
  const h4 = context.fourHour.series;
  const h4i = context.fourHour.map.indexFor[i];
  const h4Atr = h4i >= 0 ? h4.atr[h4i] : null;
  if (h4i >= 0 && h4Atr != null && h4Atr > 0) {
    push(
      h4.ema20[h4i] != null && h4.ema50[h4i] != null
        ? clip((h4.ema20[h4i]! - h4.ema50[h4i]!) / h4Atr, 10)
        : null,
    );
    push(h4.rsi[h4i] != null ? (h4.rsi[h4i]! - 50) / 50 : null);
    push(h4.macdHist[h4i] != null ? clip(h4.macdHist[h4i]! / h4Atr, 6) : null);
    push(h4.adx[h4i] != null ? h4.adx[h4i]! / 100 : null);
    push(
      h4.plusDi[h4i] != null && h4.minusDi[h4i] != null
        ? (h4.plusDi[h4i]! - h4.minusDi[h4i]!) / 100
        : null,
    );
    push(retNormalised(h4, h4i, 4));
  } else {
    for (let j = 0; j < 6; j += 1) push(null);
  }

  // --- BTC / market regime ---
  const btcIndex = market ? (market.indexByTime.get(context.candles[i].openTime) ?? -1) : -1;
  if (market && btcIndex >= FEATURE_WARMUP_BARS) {
    const btc = market.series;
    const btcAtr = btc.atr[btcIndex];
    push(retNormalised(btc, btcIndex, 4));
    push(retNormalised(btc, btcIndex, 16));
    push(retNormalised(btc, btcIndex, 96));
    push(btc.rsi[btcIndex] != null ? (btc.rsi[btcIndex]! - 50) / 50 : null);
    push(
      btc.ema20[btcIndex] != null && btc.ema50[btcIndex] != null && btcAtr != null && btcAtr > 0
        ? clip((btc.ema20[btcIndex]! - btc.ema50[btcIndex]!) / btcAtr, 10)
        : null,
    );
    push(atrRegime(btc, btcIndex));
    push(rollingCorrelation(context.logReturns, i, market.logReturns, btcIndex, 96));
    const regime = market.regimes[btcIndex];
    push(regime === "BULL" ? 1 : 0);
    push(regime === "BEAR" ? 1 : 0);
    push(regime === "HIGH_VOLATILITY" ? 1 : 0);
    push(regime === "LOW_VOLATILITY" ? 1 : 0);
    push(regime === "PANIC" ? 1 : 0);
    push(regime === "RECOVERY" ? 1 : 0);
  } else {
    for (let j = 0; j < 13; j += 1) push(null);
  }

  // A miscount here would silently shift every downstream coefficient, so it is
  // checked rather than trusted.
  if (k !== STATE_FEATURE_COUNT) {
    throw new Error(`Feature layout drift: wrote ${k}, expected ${STATE_FEATURE_COUNT}`);
  }
  return out;
}

/** Regime label at bar `i`, for display alongside the numeric features. */
export function regimeAt(market: MarketContext | null, openTime: number): MarketRegime {
  if (!market) return "NORMAL";
  const index = market.indexByTime.get(openTime);
  if (index == null) return "NORMAL";
  return market.regimes[index] ?? "NORMAL";
}
