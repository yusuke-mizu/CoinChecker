import { BARRIER_FEATURE_COUNT } from "./extract";

/** Abramowitz-Stegun normal CDF, accurate to ~7 decimals. */
export function normalCdf(x: number): number {
  const t = 1 / (1 + 0.2316419 * Math.abs(x));
  const d = 0.3989422804014327 * Math.exp((-x * x) / 2);
  const p =
    d * t * (0.319381530 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
  return x >= 0 ? 1 - p : p;
}

export function clampProbability(p: number, epsilon = 1e-4): number {
  if (!Number.isFinite(p)) return 0.5;
  return Math.min(1 - epsilon, Math.max(epsilon, p));
}

export function logit(p: number): number {
  const q = clampProbability(p);
  return Math.log(q / (1 - q));
}

export function sigmoid(z: number): number {
  if (z >= 0) return 1 / (1 + Math.exp(-z));
  const e = Math.exp(z);
  return e / (1 + e);
}

/**
 * Driftless random-walk probability of touching a barrier within `bars`.
 *
 * By the reflection principle P(max_{t<=T} W_t >= b) = 2 * (1 - Phi(b / sigma sqrt(T))).
 * This is only an analytic prior: it ignores drift, fat tails and the presence
 * of the opposite barrier. The model consumes its logit as a feature and learns
 * the corrections from real outcomes, which is far more sample-efficient than
 * asking it to rediscover the shape of a first-passage curve from scratch.
 */
export function touchPrior(distancePct: number, sigmaBar: number, bars: number): number {
  if (!(distancePct > 0) || !(sigmaBar > 0) || !(bars > 0)) return 0.5;
  const scaled = Math.log1p(distancePct / 100) / (sigmaBar * Math.sqrt(bars));
  return clampProbability(2 * (1 - normalCdf(scaled)), 1e-3);
}

/** Barrier distance measured in expected-move units for the horizon. */
export function barrierSigma(distancePct: number, sigmaBar: number, bars: number): number {
  if (!(sigmaBar > 0) || !(bars > 0)) return 99;
  return Math.log1p(distancePct / 100) / (sigmaBar * Math.sqrt(bars));
}

export type BarrierSpec = {
  targetPct: number;
  stopPct: number;
  bars: number;
};

/** Writes the barrier block into `out` starting at `offset`. */
export function writeBarrierFeatures(
  out: Float64Array,
  offset: number,
  spec: BarrierSpec,
  sigmaBar: number,
): { priorTarget: number; priorStop: number } {
  const priorTarget = touchPrior(spec.targetPct, sigmaBar, spec.bars);
  const priorStop = touchPrior(spec.stopPct, sigmaBar, spec.bars);
  const targetSigma = Math.min(8, barrierSigma(spec.targetPct, sigmaBar, spec.bars));
  const stopSigma = Math.min(8, barrierSigma(spec.stopPct, sigmaBar, spec.bars));
  out[offset] = targetSigma;
  out[offset + 1] = stopSigma;
  out[offset + 2] = Math.log(spec.bars);
  out[offset + 3] = Math.log(spec.targetPct / spec.stopPct);
  out[offset + 4] = logit(priorTarget);
  out[offset + 5] = logit(priorStop);
  return { priorTarget, priorStop };
}

if (BARRIER_FEATURE_COUNT !== 6) {
  throw new Error("Barrier feature layout out of sync with BARRIER_FEATURE_NAMES");
}
