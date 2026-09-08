import { describe, expect, it } from "vitest";
import {
  brierScore,
  buildCalibration,
  calibrationBins,
  evaluate,
  expectedCalibrationError,
  rocAuc,
} from "./calibration";
import { featureImportance, predictLogistic, trainLogistic } from "./logistic";

function seeded(seed: number) {
  let state = seed;
  return () => {
    state = (state * 1103515245 + 12345) % 2147483648;
    return state / 2147483648;
  };
}

const NAMES = ["signal", "weak", "noise"];

/** Label depends on `signal` strongly, `weak` slightly and `noise` not at all. */
function sample(rows: number, seed = 5) {
  const random = seeded(seed);
  const features: Float64Array[] = [];
  const labels = new Uint8Array(rows);
  for (let i = 0; i < rows; i += 1) {
    const signal = random() * 4 - 2;
    const weak = random() * 4 - 2;
    const noise = random() * 4 - 2;
    const z = 1.6 * signal + 0.3 * weak - 0.4;
    const p = 1 / (1 + Math.exp(-z));
    features.push(Float64Array.from([signal, weak, noise]));
    labels[i] = random() < p ? 1 : 0;
  }
  return { features, labels };
}

describe("trainLogistic", () => {
  it("recovers the sign and ordering of the true coefficients", () => {
    const { features, labels } = sample(4000);
    const model = trainLogistic(features, labels, NAMES);
    const importance = featureImportance(model);
    const bySignal = importance.find((entry) => entry.name === "signal");
    const byWeak = importance.find((entry) => entry.name === "weak");

    expect(bySignal).toBeDefined();
    expect(bySignal!.weight).toBeGreaterThan(0);
    expect(byWeak?.weight ?? 0).toBeGreaterThan(0);
    expect(bySignal!.absWeight).toBeGreaterThan(byWeak!.absWeight);
  });

  it("prunes a feature that carries no information", () => {
    const { features, labels } = sample(4000, 21);
    const model = trainLogistic(features, labels, NAMES);
    const noiseIndex = NAMES.indexOf("noise");
    const signalIndex = NAMES.indexOf("signal");
    expect(Math.abs(model.weights[noiseIndex])).toBeLessThan(
      Math.abs(model.weights[signalIndex]) / 5,
    );
  });

  it("beats the base rate on held-out data", () => {
    const train = sample(4000, 3);
    const test = sample(1500, 99);
    const model = trainLogistic(train.features, train.labels, NAMES);
    const predicted = test.features.map((row) => predictLogistic(model, row));

    let positives = 0;
    for (let i = 0; i < test.labels.length; i += 1) positives += test.labels[i];
    const baseRate = positives / test.labels.length;
    const constant = new Array(predicted.length).fill(baseRate);

    expect(brierScore(predicted, test.labels)).toBeLessThan(brierScore(constant, test.labels));
    expect(rocAuc(predicted, test.labels)).toBeGreaterThan(0.7);
  });

  it("produces probabilities that already sit near the base rate", () => {
    const { features, labels } = sample(3000, 44);
    const model = trainLogistic(features, labels, NAMES);
    const mean =
      features.map((row) => predictLogistic(model, row)).reduce((a, b) => a + b, 0) /
      features.length;
    let positives = 0;
    for (let i = 0; i < labels.length; i += 1) positives += labels[i];
    expect(mean).toBeCloseTo(positives / labels.length, 1);
  });
});

describe("calibration", () => {
  it("bins predictions and reports realised frequency", () => {
    const predicted = [0.05, 0.15, 0.15, 0.65, 0.68, 0.95];
    const actual = Uint8Array.from([0, 0, 1, 1, 0, 1]);
    const bins = calibrationBins(predicted, actual);
    const secondBin = bins.find((bin) => bin.lower === 0.1)!;
    expect(secondBin.count).toBe(2);
    expect(secondBin.actual).toBeCloseTo(0.5);
    const sixth = bins.find((bin) => bin.lower === 0.6)!;
    expect(sixth.count).toBe(2);
  });

  it("corrects a systematically overconfident model", () => {
    const random = seeded(17);
    // True probability is 0.5, but the model always claims ~0.8.
    const predicted: number[] = [];
    const actual = new Uint8Array(2000);
    for (let i = 0; i < 2000; i += 1) {
      predicted.push(0.78 + random() * 0.04);
      actual[i] = random() < 0.5 ? 1 : 0;
    }
    const before = brierScore(predicted, actual);
    const calibration = buildCalibration(predicted, actual);

    expect(calibration.method).toBe("PLATT");
    expect(calibration.brier).toBeLessThan(before);
    expect(calibration.expectedCalibrationError).toBeLessThan(0.1);

    const worst = expectedCalibrationError(calibrationBins(predicted, actual));
    expect(calibration.expectedCalibrationError).toBeLessThan(worst);
  });

  it("leaves a well calibrated model roughly unchanged", () => {
    const random = seeded(23);
    const predicted: number[] = [];
    const actual = new Uint8Array(3000);
    for (let i = 0; i < 3000; i += 1) {
      const p = 0.1 + random() * 0.8;
      predicted.push(p);
      actual[i] = random() < p ? 1 : 0;
    }
    const calibration = buildCalibration(predicted, actual);
    expect(calibration.expectedCalibrationError).toBeLessThan(0.05);
    expect(Math.abs(calibration.a - 1)).toBeLessThan(0.35);
  });

  it("scores a perfect ranking at AUC 1 and a coin flip near 0.5", () => {
    expect(rocAuc([0.1, 0.2, 0.8, 0.9], Uint8Array.from([0, 0, 1, 1]))).toBe(1);
    expect(rocAuc([0.5, 0.5, 0.5, 0.5], Uint8Array.from([0, 1, 0, 1]))).toBeCloseTo(0.5);
  });

  it("reports metrics against the analytic baseline", () => {
    const predicted = [0.9, 0.8, 0.2, 0.1];
    const baseline = [0.5, 0.5, 0.5, 0.5];
    const actual = Uint8Array.from([1, 1, 0, 0]);
    const metrics = evaluate(predicted, actual, baseline);
    expect(metrics.accuracy).toBe(1);
    expect(metrics.precision).toBe(1);
    expect(metrics.recall).toBe(1);
    expect(metrics.brier).toBeLessThan(metrics.baselineBrier);
  });
});
