import { clampProbability, writeBarrierFeatures } from "@/lib/features/barrier";
import {
  extractStateFeatures,
  FEATURE_COUNT,
  FEATURE_NAMES,
  STATE_FEATURE_COUNT,
  type MarketContext,
  type SymbolContext,
} from "@/lib/features/extract";
import type {
  DirectionModel,
  LogisticModel,
  OutcomeModel,
  PredictionDirection,
  TrainedModel,
} from "@/lib/types/prediction";
import { applyCalibration } from "./calibration";
import { predictLogistic } from "./logistic";

export type FeatureContribution = {
  name: string;
  /** weight * standardised value: the feature's signed push on the logit. */
  contribution: number;
  value: number;
};

/**
 * Reports which features moved this particular prediction.
 *
 * This is the model's own decomposition of its logit, not a scoreboard of
 * hand-assigned points: the same feature can push up on one symbol and down on
 * another depending on where its value sits relative to the training mean.
 */
export function contributions(
  model: LogisticModel,
  features: Float64Array,
  limit = 6,
): FeatureContribution[] {
  const out: FeatureContribution[] = [];
  for (let j = 0; j < model.weights.length; j += 1) {
    const weight = model.weights[j];
    if (weight === 0) continue;
    const standardised = (features[j] - model.means[j]) / model.scales[j];
    out.push({
      name: model.featureNames[j],
      contribution: weight * standardised,
      value: features[j],
    });
  }
  return out.sort((a, b) => Math.abs(b.contribution) - Math.abs(a.contribution)).slice(0, limit);
}

function score(head: OutcomeModel, features: Float64Array): number {
  return applyCalibration(head.calibration, predictLogistic(head.model, features));
}

export type PairProbability = {
  target: number;
  stop: number;
  neither: number;
};

/**
 * Live scorer bound to one symbol, one direction and one moment.
 *
 * The state features are computed once; each query only rewrites the six
 * barrier columns, so sweeping the whole target/stop/horizon grid costs three
 * dot products per combination rather than a full feature rebuild.
 */
export class SymbolPredictor {
  private readonly buffer: Float64Array;

  constructor(
    private readonly direction: DirectionModel,
    /** The other side's model, which is how adverse moves get their own head. */
    private readonly opposite: DirectionModel,
    state: Float64Array,
    private readonly sigmaBar: number,
  ) {
    this.buffer = new Float64Array(FEATURE_COUNT);
    this.buffer.set(state, 0);
  }

  private load(targetPct: number, stopPct: number, bars: number): void {
    writeBarrierFeatures(this.buffer, STATE_FEATURE_COUNT, { targetPct, stopPct, bars }, this.sigmaBar);
  }

  /** P(target touched within the window), ignoring any stop. */
  reach(targetPct: number, bars: number): number {
    // The stop columns still have to hold a plausible value; the reach head was
    // trained with them present and simply learned to lean on them very little.
    this.load(targetPct, 1, bars);
    return clampProbability(score(this.direction.reach, this.buffer), 1e-4);
  }

  /**
   * P(price moves `pct` against the position within the window).
   *
   * A drop of x% is exactly the SHORT model's reach of x%, so the opposite
   * side's head answers this directly instead of inverting a probability.
   */
  adverseReach(pct: number, bars: number): number {
    this.load(pct, 1, bars);
    return clampProbability(score(this.opposite.reach, this.buffer), 1e-4);
  }

  /** P(target first) / P(stop first) / P(neither) for a specific pair. */
  pair(targetPct: number, stopPct: number, bars: number): PairProbability {
    this.load(targetPct, stopPct, bars);
    let target = score(this.direction.target, this.buffer);
    let stop = score(this.direction.stop, this.buffer);
    // The two heads are fitted independently, so their sum can exceed one. They
    // are mutually exclusive outcomes, so rescale rather than clip.
    const total = target + stop;
    if (total > 1) {
      target /= total;
      stop /= total;
    }
    return { target, stop, neither: Math.max(0, 1 - target - stop) };
  }

  why(targetPct: number, stopPct: number, bars: number, limit = 6): FeatureContribution[] {
    this.load(targetPct, stopPct, bars);
    return contributions(this.direction.target.model, this.buffer, limit);
  }
}

export type LiveFeatures = {
  state: Float64Array;
  sigmaBar: number;
  /** Bars of usable history behind the prediction, for the confidence score. */
  barsAvailable: number;
};

export function buildLiveFeatures(
  context: SymbolContext,
  market: MarketContext | null,
  index = context.base.length - 1,
): LiveFeatures | null {
  const state = extractStateFeatures(context, index, market);
  if (!state) return null;
  const sigmaBar = context.base.sigmaBar[index];
  if (sigmaBar == null || !(sigmaBar > 0)) return null;
  return { state, sigmaBar, barsAvailable: index + 1 };
}

export function predictorFor(
  model: TrainedModel,
  direction: PredictionDirection,
  live: LiveFeatures,
): SymbolPredictor {
  return new SymbolPredictor(
    direction === "LONG" ? model.long : model.short,
    direction === "LONG" ? model.short : model.long,
    live.state,
    live.sigmaBar,
  );
}

/**
 * Confidence is deliberately separate from probability.
 *
 * A 68% that rests on a well-calibrated model, a liquid symbol and a full
 * history is a different object from a 68% extrapolated from a thin sample, and
 * collapsing them into one number is how people end up trusting noise.
 */
export function confidenceScore(input: {
  model: TrainedModel;
  direction: PredictionDirection;
  barsAvailable: number;
  requiredBars: number;
  turnoverUsd: number | null;
  hasFunding: boolean;
  hasOrderFlow: boolean;
  hasBtcContext: boolean;
  regimeStable: boolean;
  /** Gap between the model output and the analytic prior, in probability units. */
  modelDisagreement: number;
}): { score: number; band: "HIGH" | "MEDIUM" | "LOW"; reasons: string[] } {
  const head = (input.direction === "LONG" ? input.model.long : input.model.short).target;
  const reasons: string[] = [];
  let score = 0;

  // Training volume behind the head.
  const rows = head.model.trainRows;
  const rowScore = Math.min(1, rows / 20_000);
  score += rowScore * 22;
  if (rows < 5_000) reasons.push(`学習サンプルが${rows.toLocaleString()}件と少なめ`);

  // Calibration quality: how closely stated probabilities matched reality.
  const ece = head.calibration.expectedCalibrationError;
  const calibrationScore = Math.max(0, 1 - ece / 0.1);
  score += calibrationScore * 22;
  if (ece > 0.05) reasons.push(`Calibration誤差が${(ece * 100).toFixed(1)}ptと大きい`);

  // Discrimination on held-out data.
  const auc = head.metrics.auc;
  score += Math.max(0, Math.min(1, (auc - 0.5) / 0.2)) * 16;
  if (auc < 0.55) reasons.push(`Out-of-sample AUCが${auc.toFixed(3)}と低い`);

  // History behind this specific symbol.
  const historyScore = Math.min(1, input.barsAvailable / input.requiredBars);
  score += historyScore * 14;
  if (input.barsAvailable < input.requiredBars) {
    reasons.push(`この銘柄の15m足が${input.barsAvailable}本と不足`);
  }

  // Input completeness.
  let inputs = 0;
  if (input.hasFunding) inputs += 1;
  if (input.hasOrderFlow) inputs += 1;
  if (input.hasBtcContext) inputs += 1;
  score += (inputs / 3) * 10;
  if (!input.hasOrderFlow) reasons.push("Taker出来高が無くCVD特徴量は欠測");
  if (!input.hasBtcContext) reasons.push("BTC市場環境の特徴量が欠測");

  // Liquidity.
  const turnover = input.turnoverUsd ?? 0;
  score += Math.min(1, turnover / 20_000_000) * 8;
  if (turnover > 0 && turnover < 3_000_000) reasons.push("24時間出来高が小さく滑りやすい");

  // Regime stability and model-vs-prior agreement.
  score += input.regimeStable ? 4 : 0;
  if (!input.regimeStable) reasons.push("市場レジームが不安定");
  const agreement = Math.max(0, 1 - input.modelDisagreement / 0.35);
  score += agreement * 4;
  if (input.modelDisagreement > 0.25) reasons.push("モデルと解析近似の乖離が大きい");

  const rounded = Math.round(Math.max(0, Math.min(100, score)));
  return {
    score: rounded,
    band: rounded >= 65 ? "HIGH" : rounded >= 40 ? "MEDIUM" : "LOW",
    reasons,
  };
}

/** Bars of 15m history a symbol needs before the model is trusted at full weight. */
export const REQUIRED_BARS = 900;

export { FEATURE_NAMES };
