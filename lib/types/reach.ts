import type { EntryVerdict, HoldingWindow } from "./trade-decision";

export type EntryGrade = "EXCELLENT" | "GOOD" | "FAIR" | "POOR" | "AVOID";

/** How much of the estimate came from conditioned history vs the volatility model. */
export type EstimateBasis = "EMPIRICAL" | "BLENDED" | "MODEL";

export type ReachEstimate = {
  levelPct: number;
  /** Estimated chance of touching this distance inside the horizon, 0-100. */
  probability: number;
  basis: EstimateBasis;
};

export type TargetCandidate = {
  targetPct: number;
  targetPrice: number;
  stopPct: number;
  stopPrice: number;
  /** Chance the target is touched before the stop, 0-100. */
  targetProbability: number;
  stopProbability: number;
  neitherProbability: number;
  expectedValuePct: number;
  rewardRisk: number;
  recommended: boolean;
};

export type TiltFactor = {
  label: string;
  deltaLogit: number;
};

export type ReachAnalysis = {
  direction: "LONG" | "SHORT";
  entryPrice: number;
  horizonHours: number;
  barTimeframe: "15m" | "1h";
  sampleSize: number;
  effectiveSampleSize: number;
  /** Reliability of the estimate itself, separate from trade attractiveness. */
  confidence: number;
  favorable: ReachEstimate[];
  adverse: ReachEstimate[];
  favorableAnyProbability: number;
  adverseAnyProbability: number;
  expectedDriftPct: number;
  volatilityPerHorizonPct: number;
  candidates: TargetCandidate[];
  recommendedStopPct: number;
  recommendedStopPrice: number;
  recommendedTarget1Pct: number;
  recommendedTarget1Price: number;
  recommendedTarget2Pct: number;
  recommendedTarget2Price: number;
  expectedValuePct: number;
  rewardRisk: number;
  holdingWindow: HoldingWindow;
  entryTiming: EntryVerdict;
  entryGrade: EntryGrade;
  chaseRisk: number;
  tiltFactors: TiltFactor[];
  reasons: string[];
};

export type DirectionalReach = {
  long: ReachAnalysis | null;
  short: ReachAnalysis | null;
};
