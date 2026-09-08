import { clampProbability, logit, sigmoid } from "@/lib/features/barrier";
import type { Calibration, CalibrationBin, ModelMetrics } from "@/lib/types/prediction";

/** Ten fixed deciles, so the calibration table is comparable between models. */
const BIN_EDGES = [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0];

export function calibrationBins(predicted: number[], actual: Uint8Array): CalibrationBin[] {
  const bins: CalibrationBin[] = [];
  for (let b = 0; b < BIN_EDGES.length - 1; b += 1) {
    const lower = BIN_EDGES[b];
    const upper = BIN_EDGES[b + 1];
    let sum = 0;
    let hits = 0;
    let count = 0;
    for (let i = 0; i < predicted.length; i += 1) {
      const p = predicted[i];
      const inBin = b === BIN_EDGES.length - 2 ? p >= lower && p <= upper : p >= lower && p < upper;
      if (!inBin) continue;
      sum += p;
      hits += actual[i];
      count += 1;
    }
    bins.push({
      lower,
      upper,
      predicted: count ? sum / count : 0,
      actual: count ? hits / count : 0,
      count,
    });
  }
  return bins;
}

export function brierScore(predicted: number[], actual: Uint8Array): number {
  if (!predicted.length) return 0;
  let sum = 0;
  for (let i = 0; i < predicted.length; i += 1) sum += (predicted[i] - actual[i]) ** 2;
  return sum / predicted.length;
}

export function logLoss(predicted: number[], actual: Uint8Array): number {
  if (!predicted.length) return 0;
  let sum = 0;
  for (let i = 0; i < predicted.length; i += 1) {
    const p = clampProbability(predicted[i], 1e-6);
    sum += actual[i] ? -Math.log(p) : -Math.log(1 - p);
  }
  return sum / predicted.length;
}

/** Sample-weighted mean gap between predicted and realised frequency. */
export function expectedCalibrationError(bins: CalibrationBin[]): number {
  let total = 0;
  let weighted = 0;
  for (const bin of bins) {
    total += bin.count;
    weighted += bin.count * Math.abs(bin.predicted - bin.actual);
  }
  return total ? weighted / total : 0;
}

/** Rank-based AUC (Mann-Whitney), tie-corrected. */
export function rocAuc(predicted: number[], actual: Uint8Array): number {
  const order = predicted.map((p, index) => ({ p, y: actual[index] })).sort((a, b) => a.p - b.p);
  let positives = 0;
  let negatives = 0;
  for (const item of order) {
    if (item.y) positives += 1;
    else negatives += 1;
  }
  if (!positives || !negatives) return 0.5;
  let rankSum = 0;
  let i = 0;
  while (i < order.length) {
    let j = i;
    while (j + 1 < order.length && order[j + 1].p === order[i].p) j += 1;
    const averageRank = (i + j) / 2 + 1;
    for (let k = i; k <= j; k += 1) if (order[k].y) rankSum += averageRank;
    i = j + 1;
  }
  return (rankSum - (positives * (positives + 1)) / 2) / (positives * negatives);
}

/**
 * Platt scaling on the logit: p' = sigmoid(a * logit(p) + b).
 *
 * Fitted by Newton steps on the two-parameter log-loss. This must be fitted on
 * held-out predictions — calibrating on the training fold would just relearn the
 * training distribution and report a calibration quality the model does not have.
 */
export function fitPlatt(predicted: number[], actual: Uint8Array): { a: number; b: number } {
  let a = 1;
  let b = 0;
  const n = predicted.length;
  if (n < 50) return { a, b };
  const z = predicted.map((p) => logit(p));

  for (let iteration = 0; iteration < 40; iteration += 1) {
    let g0 = 0;
    let g1 = 0;
    let h00 = 0;
    let h01 = 0;
    let h11 = 0;
    for (let i = 0; i < n; i += 1) {
      const p = sigmoid(a * z[i] + b);
      const error = p - actual[i];
      const w = Math.max(1e-9, p * (1 - p));
      g0 += error * z[i];
      g1 += error;
      h00 += w * z[i] * z[i];
      h01 += w * z[i];
      h11 += w;
    }
    // Ridge term keeps the Hessian invertible on degenerate folds.
    h00 += 1e-6;
    h11 += 1e-6;
    const determinant = h00 * h11 - h01 * h01;
    if (!Number.isFinite(determinant) || Math.abs(determinant) < 1e-12) break;
    const da = (h11 * g0 - h01 * g1) / determinant;
    const db = (h00 * g1 - h01 * g0) / determinant;
    a -= da;
    b -= db;
    if (Math.abs(da) < 1e-8 && Math.abs(db) < 1e-8) break;
  }
  if (!Number.isFinite(a) || !Number.isFinite(b) || a <= 0) return { a: 1, b: 0 };
  return { a, b };
}

export function applyCalibration(calibration: Calibration, probability: number): number {
  if (calibration.method !== "PLATT") return probability;
  return clampProbability(sigmoid(calibration.a * logit(probability) + calibration.b));
}

export function buildCalibration(predicted: number[], actual: Uint8Array): Calibration {
  const { a, b } = fitPlatt(predicted, actual);
  const method: Calibration["method"] = predicted.length >= 50 ? "PLATT" : "NONE";
  const adjusted =
    method === "PLATT" ? predicted.map((p) => clampProbability(sigmoid(a * logit(p) + b))) : predicted;
  const bins = calibrationBins(adjusted, actual);
  return {
    method,
    a: method === "PLATT" ? a : 1,
    b: method === "PLATT" ? b : 0,
    bins,
    brier: brierScore(adjusted, actual),
    expectedCalibrationError: expectedCalibrationError(bins),
    logLoss: logLoss(adjusted, actual),
    sampleCount: predicted.length,
  };
}

export function evaluate(
  predicted: number[],
  actual: Uint8Array,
  baseline: number[],
  threshold = 0.5,
): ModelMetrics {
  let positives = 0;
  let truePositive = 0;
  let falsePositive = 0;
  let falseNegative = 0;
  let correct = 0;
  for (let i = 0; i < predicted.length; i += 1) {
    const y = actual[i];
    positives += y;
    const yHat = predicted[i] >= threshold ? 1 : 0;
    if (yHat === y) correct += 1;
    if (yHat === 1 && y === 1) truePositive += 1;
    if (yHat === 1 && y === 0) falsePositive += 1;
    if (yHat === 0 && y === 1) falseNegative += 1;
  }
  const n = predicted.length || 1;
  return {
    rows: predicted.length,
    positiveRate: positives / n,
    auc: rocAuc(predicted, actual),
    brier: brierScore(predicted, actual),
    logLoss: logLoss(predicted, actual),
    baselineBrier: brierScore(baseline, actual),
    accuracy: correct / n,
    precision: truePositive + falsePositive ? truePositive / (truePositive + falsePositive) : 0,
    recall: truePositive + falseNegative ? truePositive / (truePositive + falseNegative) : 0,
  };
}
