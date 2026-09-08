import type { Calibration, PredictionRecord } from "@/lib/types/prediction";
import { brierScore, calibrationBins, expectedCalibrationError, logLoss, rocAuc } from "./calibration";

/**
 * Calibration measured on the app's own live predictions.
 *
 * This is the number that answers "is this app's 64% really about 64%". It is
 * computed only from records that were written before the outcome existed and
 * have since resolved, so it cannot be inflated by rescoring history with the
 * current model.
 */
export type LiveCalibration = {
  resolved: number;
  pending: number;
  /** Realised win rate of the target-first outcome. */
  hitRate: number;
  brier: number;
  logLoss: number;
  auc: number;
  expectedCalibrationError: number;
  bins: Calibration["bins"];
  /** Mean predicted EV against mean realised return, both in percent. */
  predictedEvPct: number;
  realisedReturnPct: number;
  byModelVersion: Array<{ version: string; resolved: number; hitRate: number; brier: number }>;
  ambiguousSameBar: number;
};

export function emptyLiveCalibration(pending = 0): LiveCalibration {
  return {
    resolved: 0,
    pending,
    hitRate: 0,
    brier: 0,
    logLoss: 0,
    auc: 0.5,
    expectedCalibrationError: 0,
    bins: [],
    predictedEvPct: 0,
    realisedReturnPct: 0,
    byModelVersion: [],
    ambiguousSameBar: 0,
  };
}

export function computeLiveCalibration(records: PredictionRecord[]): LiveCalibration {
  const resolved = records.filter((record) => record.result != null);
  const pending = records.length - resolved.length;
  if (resolved.length === 0) return emptyLiveCalibration(pending);

  const predicted = resolved.map((record) => record.targetProbability);
  const actual = new Uint8Array(resolved.length);
  resolved.forEach((record, index) => {
    actual[index] = record.result!.outcome === "TARGET" ? 1 : 0;
  });

  const bins = calibrationBins(predicted, actual);
  const versions = new Map<string, { resolved: number; hits: number; squared: number }>();
  let ambiguous = 0;
  let predictedEv = 0;
  let realised = 0;
  resolved.forEach((record, index) => {
    const entry = versions.get(record.modelVersion) ?? { resolved: 0, hits: 0, squared: 0 };
    entry.resolved += 1;
    entry.hits += actual[index];
    entry.squared += (predicted[index] - actual[index]) ** 2;
    versions.set(record.modelVersion, entry);
    if (record.result!.ambiguousSameBar) ambiguous += 1;
    predictedEv += record.expectedValuePct;
    realised += record.result!.returnPct;
  });

  let hits = 0;
  for (let i = 0; i < actual.length; i += 1) hits += actual[i];

  return {
    resolved: resolved.length,
    pending,
    hitRate: hits / resolved.length,
    brier: brierScore(predicted, actual),
    logLoss: logLoss(predicted, actual),
    auc: rocAuc(predicted, actual),
    expectedCalibrationError: expectedCalibrationError(bins),
    bins,
    predictedEvPct: predictedEv / resolved.length,
    realisedReturnPct: realised / resolved.length,
    byModelVersion: Array.from(versions.entries())
      .map(([version, entry]) => ({
        version,
        resolved: entry.resolved,
        hitRate: entry.hits / entry.resolved,
        brier: entry.squared / entry.resolved,
      }))
      .sort((a, b) => b.resolved - a.resolved),
    ambiguousSameBar: ambiguous,
  };
}
