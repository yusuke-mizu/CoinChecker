import { atrSeries, emaSeries, rsiSeries } from "@/lib/indicators";
import type { Candle } from "@/lib/types/market";

/**
 * Shared first-passage machinery for "if I enter at the current price" estimates.
 *
 * The historical scan is run once per symbol over the longest horizon. Because it
 * stores the bar offset at which each distance was first touched, a shorter
 * horizon only needs `firstTouch <= bars`, and any TP/SL pair is resolved by
 * comparing two offsets. No re-scan is needed per horizon or per candidate.
 */

/** Barrier distances, percent of entry price. */
export const BARRIER_GRID = [
  0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 2.5, 3, 4, 5, 7, 10,
];

export const FEATURE_WARMUP = 60;
/** Blend point between the conditioned empirical estimate and the model. */
export const ESS_HALF_WEIGHT = 20;

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function normalCdf(x: number): number {
  // Abramowitz & Stegun 7.1.26 applied to erf.
  const sign = x < 0 ? -1 : 1;
  const z = Math.abs(x) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * z);
  const erf =
    1 -
    ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t +
      0.254829592) *
      t *
      Math.exp(-z * z);
  return 0.5 * (1 + sign * erf);
}

export function logit(p: number): number {
  const bounded = clamp(p, 1e-4, 1 - 1e-4);
  return Math.log(bounded / (1 - bounded));
}

export function sigmoid(x: number): number {
  return 1 / (1 + Math.exp(-x));
}

export function logBarrier(pct: number, up: boolean): number {
  return up ? Math.log(1 + pct / 100) : -Math.log(1 - pct / 100);
}

export function snapToGrid(pct: number): { value: number; index: number } {
  let index = 0;
  let best = Number.POSITIVE_INFINITY;
  for (let g = 0; g < BARRIER_GRID.length; g += 1) {
    const distance = Math.abs(BARRIER_GRID[g] - pct);
    if (distance < best) {
      best = distance;
      index = g;
    }
  }
  return { value: BARRIER_GRID[index], index };
}

/** Probabilities must not increase as the barrier distance grows. */
export function enforceMonotonic(values: number[]): number[] {
  const out = [...values];
  for (let i = 1; i < out.length; i += 1) out[i] = Math.min(out[i], out[i - 1]);
  return out;
}

export type FirstTouchSample = {
  /** Bar offset of the first touch of each grid distance above entry, or Infinity. */
  firstUp: number[];
  firstDown: number[];
  /** Close-to-close result at each requested horizon, percent. */
  closeReturnPct: number[];
  weight: number;
};

export function scanFirstTouch(
  candles: Candle[],
  horizons: number[],
  warmup = FEATURE_WARMUP,
): FirstTouchSample[] {
  const maxHorizon = Math.max(...horizons);
  const samples: FirstTouchSample[] = [];
  const last = candles.length - 1 - maxHorizon;
  for (let t = warmup; t <= last; t += 1) {
    const entry = candles[t].close;
    if (!(entry > 0)) continue;
    const firstUp = new Array<number>(BARRIER_GRID.length).fill(Number.POSITIVE_INFINITY);
    const firstDown = new Array<number>(BARRIER_GRID.length).fill(Number.POSITIVE_INFINITY);
    let maxUp = 0;
    let maxDown = 0;
    for (let j = 1; j <= maxHorizon; j += 1) {
      const bar = candles[t + j];
      const up = ((bar.high - entry) / entry) * 100;
      const down = ((entry - bar.low) / entry) * 100;
      if (up > maxUp) {
        maxUp = up;
        for (let g = 0; g < BARRIER_GRID.length; g += 1) {
          if (!Number.isFinite(firstUp[g]) && maxUp >= BARRIER_GRID[g]) firstUp[g] = j;
        }
      }
      if (down > maxDown) {
        maxDown = down;
        for (let g = 0; g < BARRIER_GRID.length; g += 1) {
          if (!Number.isFinite(firstDown[g]) && maxDown >= BARRIER_GRID[g]) firstDown[g] = j;
        }
      }
    }
    samples.push({
      firstUp,
      firstDown,
      closeReturnPct: horizons.map(
        (bars) => ((candles[t + bars].close - entry) / entry) * 100,
      ),
      weight: 1,
    });
  }
  return samples;
}

export type StateFeatures = {
  atrPct: Array<number | null>;
  rsi: Array<number | null>;
  trendUp: boolean[];
  position: Array<number | null>;
  volumeRatio: Array<number | null>;
};

export function stateFeatures(candles: Candle[]): StateFeatures {
  const closes = candles.map((candle) => candle.close);
  const atr = atrSeries(candles);
  const ema50 = emaSeries(closes, 50);
  const ema200 = emaSeries(closes, 200);
  return {
    atrPct: atr.map((value, index) =>
      value == null || !(closes[index] > 0) ? null : (value / closes[index]) * 100,
    ),
    rsi: rsiSeries(closes, 14),
    trendUp: candles.map((_, index) => {
      const mid = ema50[index];
      const slow = ema200[index];
      // Falls back to the 50 EMA slope while 200 is still warming up.
      if (mid != null && slow != null) return mid > slow;
      if (mid != null && index > 0 && ema50[index - 1] != null) return mid > ema50[index - 1]!;
      return false;
    }),
    position: candles.map((_, index) => {
      if (index < 48) return null;
      let high = -Infinity;
      let low = Infinity;
      for (let j = index - 47; j <= index; j += 1) {
        high = Math.max(high, candles[j].high);
        low = Math.min(low, candles[j].low);
      }
      return high > low ? ((closes[index] - low) / (high - low)) * 100 : null;
    }),
    volumeRatio: candles.map((_, index) => {
      if (index < 20) return null;
      let sum = 0;
      for (let j = index - 19; j <= index; j += 1) sum += candles[j].volume;
      const average = sum / 20;
      return average > 0 ? candles[index].volume / average : null;
    }),
  };
}

/**
 * Gaussian kernel over volatility, momentum, trend regime, range location and
 * participation. Dissimilar history still contributes, just far less, so the
 * estimate is conditioned on the current state rather than gated by thresholds.
 */
export function weightSamples(
  samples: FirstTouchSample[],
  features: StateFeatures,
  warmup = FEATURE_WARMUP,
  referenceIndex?: number,
): { total: number; ess: number } {
  const now = referenceIndex ?? features.rsi.length - 1;
  const atrNow = features.atrPct[now];
  const rsiNow = features.rsi[now];
  const trendNow = features.trendUp[now];
  const positionNow = features.position[now];
  const volumeNow = features.volumeRatio[now];

  let total = 0;
  let totalSquares = 0;
  for (let s = 0; s < samples.length; s += 1) {
    const index = warmup + s;
    let distance = 0;
    const atr = features.atrPct[index];
    if (atr != null && atrNow != null && atr > 0 && atrNow > 0) {
      distance += (Math.log(atr / atrNow) / 0.45) ** 2;
    }
    const rsi = features.rsi[index];
    if (rsi != null && rsiNow != null) distance += ((rsi - rsiNow) / 18) ** 2;
    if (features.trendUp[index] !== trendNow) distance += 1.6;
    const position = features.position[index];
    if (position != null && positionNow != null) {
      distance += ((position - positionNow) / 28) ** 2;
    }
    const volume = features.volumeRatio[index];
    if (volume != null && volumeNow != null && volume > 0 && volumeNow > 0) {
      distance += 0.5 * (Math.log(volume / volumeNow) / 0.6) ** 2;
    }
    const weight = Math.max(0.02, Math.exp(-0.5 * distance));
    samples[s].weight = weight;
    total += weight;
    totalSquares += weight * weight;
  }
  return { total, ess: totalSquares > 0 ? (total * total) / totalSquares : 0 };
}

export type VolatilityModel = {
  sigmaBar: number;
  muBar: number;
  sigmaPerHour: number;
  barMinutes: number;
};

export function volatilityModel(candles: Candle[], barMinutes: number): VolatilityModel {
  const window = candles.slice(-Math.min(200, candles.length));
  const logReturns: number[] = [];
  for (let i = 1; i < window.length; i += 1) {
    const previous = window[i - 1].close;
    if (previous > 0 && window[i].close > 0) {
      logReturns.push(Math.log(window[i].close / previous));
    }
  }
  const mean = logReturns.length
    ? logReturns.reduce((sum, value) => sum + value, 0) / logReturns.length
    : 0;
  const variance =
    logReturns.length > 1
      ? logReturns.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (logReturns.length - 1)
      : 0;
  const sigmaBar = Math.max(Math.sqrt(variance), 1e-5);
  return {
    sigmaBar,
    // Drift estimated from a few hundred bars is mostly noise, so it is shrunk hard.
    muBar: clamp(mean * 0.25, -sigmaBar * 0.5, sigmaBar * 0.5),
    sigmaPerHour: sigmaBar * Math.sqrt(60 / barMinutes),
    barMinutes,
  };
}

/** First-passage probability for a drifting Brownian motion barrier. */
export function touchProbability(
  barrier: number,
  model: VolatilityModel,
  bars: number,
  favorable: boolean,
): number {
  const sigma = model.sigmaBar * Math.sqrt(bars);
  const mu = (favorable ? model.muBar : -model.muBar) * bars;
  if (!(sigma > 0) || !(barrier > 0)) return 0;
  const first = normalCdf((-barrier + mu) / sigma);
  const exponent = clamp((2 * mu * barrier) / (sigma * sigma), -30, 30);
  return clamp(first + Math.exp(exponent) * normalCdf((-barrier - mu) / sigma), 0, 1);
}

/**
 * Model fallback for "which barrier comes first": chance either is touched inside
 * the horizon, split by the driftless gambler's ruin ratio of the log distances.
 */
export function modelPairSplit(
  favorableBarrier: number,
  adverseBarrier: number,
  model: VolatilityModel,
  bars: number,
): { target: number; stop: number } {
  const touchTarget = touchProbability(favorableBarrier, model, bars, true);
  const touchStop = touchProbability(adverseBarrier, model, bars, false);
  const either = clamp(touchTarget + touchStop - touchTarget * touchStop, 0, 1);
  const share = adverseBarrier / (favorableBarrier + adverseBarrier);
  const target = either * share;
  return { target, stop: either - target };
}

export function blendWeight(ess: number): number {
  return ess / (ess + ESS_HALF_WEIGHT);
}

export function estimateBasis(lambda: number): "EMPIRICAL" | "BLENDED" | "MODEL" {
  return lambda >= 0.7 ? "EMPIRICAL" : lambda >= 0.3 ? "BLENDED" : "MODEL";
}
