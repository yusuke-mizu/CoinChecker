import type { CandleVenue } from "./venue";

/** Market regime label derived from BTC-wide state, used as a model feature. */
export type MarketRegime =
  | "NORMAL"
  | "BULL"
  | "BEAR"
  | "HIGH_VOLATILITY"
  | "LOW_VOLATILITY"
  | "PANIC"
  | "RECOVERY";

export const MARKET_REGIMES: MarketRegime[] = [
  "NORMAL",
  "BULL",
  "BEAR",
  "HIGH_VOLATILITY",
  "LOW_VOLATILITY",
  "PANIC",
  "RECOVERY",
];

export type PredictionDirection = "LONG" | "SHORT";

/** First-touch outcome inside a horizon. Ties resolve to STOP, never to TARGET. */
export type TouchOutcome = "TARGET" | "STOP" | "NEITHER";

export type LogisticModel = {
  /** Feature names in coefficient order. Guards against silent reordering. */
  featureNames: string[];
  /** Standardisation applied before the dot product. */
  means: number[];
  scales: number[];
  weights: number[];
  intercept: number;
  l2: number;
  iterations: number;
  trainRows: number;
  /** Mean of the label in training data, for reference against the intercept. */
  baseRate: number;
};

export type CalibrationBin = {
  lower: number;
  upper: number;
  predicted: number;
  actual: number;
  count: number;
};

export type Calibration = {
  method: "PLATT" | "BINNING" | "NONE";
  /** Platt scaling on the logit: p' = sigmoid(a * logit(p) + b). */
  a: number;
  b: number;
  bins: CalibrationBin[];
  brier: number;
  /** Expected calibration error: sample-weighted |predicted - actual|. */
  expectedCalibrationError: number;
  logLoss: number;
  sampleCount: number;
};

export type ModelMetrics = {
  rows: number;
  positiveRate: number;
  auc: number;
  brier: number;
  logLoss: number;
  /** Brier score of the analytic baseline the model corrects, for comparison. */
  baselineBrier: number;
  accuracy: number;
  precision: number;
  recall: number;
};

export type FeatureImportance = {
  name: string;
  /** Standardised coefficient: comparable across features. */
  weight: number;
  absWeight: number;
};

export type WalkForwardFold = {
  index: number;
  trainRows: number;
  testRows: number;
  trainUntil: string;
  testFrom: string;
  testUntil: string;
  metrics: ModelMetrics;
  calibration: Calibration;
};

export type OutcomeModel = {
  outcome: "TARGET" | "STOP";
  model: LogisticModel;
  calibration: Calibration;
  metrics: ModelMetrics;
  importance: FeatureImportance[];
};

export type DirectionModel = {
  direction: PredictionDirection;
  target: OutcomeModel;
  stop: OutcomeModel;
};

export type TrainedModel = {
  version: string;
  createdAt: string;
  /** Data provenance so a stored prediction can be traced to its training set. */
  training: {
    symbols: string[];
    venue: CandleVenue | "mixed";
    barMinutes: number;
    barsPerSymbol: number;
    firstSampleAt: string;
    lastSampleAt: string;
    totalRows: number;
    ambiguousSameBarRows: number;
    combosPerBar: number;
  };
  long: DirectionModel;
  short: DirectionModel;
  walkForward: WalkForwardFold[];
  notes: string[];
};

/** Compact summary for listing models without transferring every coefficient. */
export type ModelSummary = {
  version: string;
  createdAt: string;
  totalRows: number;
  symbols: number;
  longTargetAuc: number;
  longTargetBrier: number;
  shortTargetAuc: number;
  shortTargetBrier: number;
  walkForwardFolds: number;
};

export type PredictionRecord = {
  id: string;
  timestamp: string;
  modelVersion: string;
  symbol: string;
  direction: PredictionDirection;
  entryPrice: number;
  targetPct: number;
  stopPct: number;
  horizonMinutes: number;
  targetProbability: number;
  stopProbability: number;
  expectedValuePct: number;
  confidence: number;
  confidenceBand: "HIGH" | "MEDIUM" | "LOW";
  recommendedLeverageMax: number;
  holdingMinutes: number;
  verdict: string;
  /** Feature snapshot, so the prediction can be re-scored by a future model. */
  features: Record<string, number>;
  resolvesAt: string;
  result: PredictionResult | null;
};

export type PredictionResult = {
  resolvedAt: string;
  outcome: TouchOutcome;
  returnPct: number;
  maxFavorableExcursionPct: number;
  maxAdverseExcursionPct: number;
  holdingMinutes: number;
  ambiguousSameBar: boolean;
};
