import { sigmoid } from "@/lib/features/barrier";
import type { FeatureImportance, LogisticModel } from "@/lib/types/prediction";

/**
 * L2-regularised logistic regression trained with full-batch gradient descent
 * plus Nesterov momentum.
 *
 * No ML dependency is available in this project and none can be added without
 * changing the Workers bundle, so this is hand-rolled. Logistic regression is
 * also the right first model here: it is convex (no seed lottery), its
 * standardised coefficients are directly readable as feature importance, and it
 * calibrates far more gracefully than a tree ensemble on a few tens of
 * thousands of correlated rows.
 */

export type TrainOptions = {
  l2: number;
  iterations: number;
  learningRate: number;
  /** Drop features whose standardised weight is below this, then refit once. */
  pruneThreshold: number;
};

export const DEFAULT_TRAIN_OPTIONS: TrainOptions = {
  l2: 1.0,
  iterations: 220,
  learningRate: 0.5,
  pruneThreshold: 0.01,
};

type Standardisation = { means: number[]; scales: number[] };

function standardise(rows: Float64Array[], columns: number[]): Standardisation {
  const means: number[] = [];
  const scales: number[] = [];
  for (const column of columns) {
    let sum = 0;
    for (const row of rows) sum += row[column];
    const mean = rows.length ? sum / rows.length : 0;
    let variance = 0;
    for (const row of rows) variance += (row[column] - mean) ** 2;
    variance = rows.length > 1 ? variance / (rows.length - 1) : 0;
    const scale = Math.sqrt(variance);
    means.push(mean);
    scales.push(scale > 1e-8 ? scale : 1);
  }
  return { means, scales };
}

function fit(
  rows: Float64Array[],
  labels: Uint8Array,
  columns: number[],
  standardisation: Standardisation,
  options: TrainOptions,
): { weights: number[]; intercept: number } {
  const n = rows.length;
  const d = columns.length;
  const weights = new Float64Array(d);
  const velocity = new Float64Array(d);
  let intercept = 0;
  let interceptVelocity = 0;
  const gradient = new Float64Array(d);
  const momentum = 0.9;
  const { means, scales } = standardisation;

  // Start the intercept at the base-rate logit so the fit begins calibrated.
  let positives = 0;
  for (let i = 0; i < n; i += 1) positives += labels[i];
  const baseRate = n ? Math.min(0.999, Math.max(0.001, positives / n)) : 0.5;
  intercept = Math.log(baseRate / (1 - baseRate));

  const scaled = new Float64Array(n * d);
  for (let i = 0; i < n; i += 1) {
    const row = rows[i];
    for (let j = 0; j < d; j += 1) {
      scaled[i * d + j] = (row[columns[j]] - means[j]) / scales[j];
    }
  }

  for (let iteration = 0; iteration < options.iterations; iteration += 1) {
    gradient.fill(0);
    let interceptGradient = 0;
    // Nesterov look-ahead point.
    for (let j = 0; j < d; j += 1) weights[j] += momentum * velocity[j];
    const lookaheadIntercept = intercept + momentum * interceptVelocity;

    for (let i = 0; i < n; i += 1) {
      let z = lookaheadIntercept;
      const offset = i * d;
      for (let j = 0; j < d; j += 1) z += weights[j] * scaled[offset + j];
      const error = sigmoid(z) - labels[i];
      interceptGradient += error;
      for (let j = 0; j < d; j += 1) gradient[j] += error * scaled[offset + j];
    }

    const step = options.learningRate / n;
    for (let j = 0; j < d; j += 1) {
      weights[j] -= momentum * velocity[j];
      // L2 shrinks coefficients but never the intercept.
      const g = gradient[j] / n + (options.l2 * weights[j]) / n;
      velocity[j] = momentum * velocity[j] - options.learningRate * g;
      weights[j] += velocity[j];
    }
    interceptVelocity = momentum * interceptVelocity - step * interceptGradient;
    intercept += interceptVelocity;
  }

  return { weights: Array.from(weights), intercept };
}

export function trainLogistic(
  rows: Float64Array[],
  labels: Uint8Array,
  featureNames: string[],
  options: TrainOptions = DEFAULT_TRAIN_OPTIONS,
): LogisticModel {
  const allColumns = featureNames.map((_, index) => index);
  const first = standardise(rows, allColumns);
  const initial = fit(rows, labels, allColumns, first, options);

  // Unnecessary-feature removal: anything the first fit shrank to noise is
  // dropped and the model refits on what is left, which keeps the reported
  // importance list honest and reduces variance on the small folds.
  const keep = allColumns.filter(
    (_, index) => Math.abs(initial.weights[index]) >= options.pruneThreshold,
  );
  const columns = keep.length >= 4 ? keep : allColumns;
  const standardisation = columns === allColumns ? first : standardise(rows, columns);
  const final = columns === allColumns ? initial : fit(rows, labels, columns, standardisation, options);

  // Re-expand to the full feature layout so inference never has to know which
  // columns survived: pruned features simply carry a zero weight.
  const means = new Array(featureNames.length).fill(0);
  const scales = new Array(featureNames.length).fill(1);
  const weights = new Array(featureNames.length).fill(0);
  columns.forEach((column, index) => {
    means[column] = standardisation.means[index];
    scales[column] = standardisation.scales[index];
    weights[column] = final.weights[index];
  });

  let positives = 0;
  for (let i = 0; i < labels.length; i += 1) positives += labels[i];

  return {
    featureNames,
    means,
    scales,
    weights,
    intercept: final.intercept,
    l2: options.l2,
    iterations: options.iterations,
    trainRows: rows.length,
    baseRate: rows.length ? positives / rows.length : 0,
  };
}

export function predictLogistic(model: LogisticModel, features: Float64Array): number {
  let z = model.intercept;
  for (let j = 0; j < model.weights.length; j += 1) {
    const weight = model.weights[j];
    if (weight === 0) continue;
    z += weight * ((features[j] - model.means[j]) / model.scales[j]);
  }
  return sigmoid(z);
}

export function featureImportance(model: LogisticModel): FeatureImportance[] {
  return model.featureNames
    .map((name, index) => ({
      name,
      weight: model.weights[index],
      absWeight: Math.abs(model.weights[index]),
    }))
    .filter((entry) => entry.absWeight > 0)
    .sort((a, b) => b.absWeight - a.absWeight);
}
