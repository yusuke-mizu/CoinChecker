import type { CandleVenue } from "./venue";

export type OpportunityDirection = "LONG" | "SHORT";

/** Entry call shown on the board. Deliberately four states, not a score. */
export type OpportunityVerdict =
  | "ENTER NOW"
  | "GOOD BUT WAIT"
  | "WAIT FOR PULLBACK"
  | "NO ENTRY";

export type EstimateBasis = "EMPIRICAL" | "BLENDED" | "MODEL";

/** One row of the "how long is it rational to hold" table. */
export type HorizonEstimate = {
  label: string;
  minutes: number;
  levelPct: number;
  /** Chance of touching +levelPct (direction-adjusted) inside the window. */
  probability: number;
  /** Chance of touching the recommended stop inside the window. */
  stopProbability: number;
  /** Expected value of the recommended TP/SL pair if the trade is closed here. */
  expectedValuePct: number;
  expectedValuePerHourPct: number;
  basis: EstimateBasis;
  recommended: boolean;
};

export type StopAnchor = "ATR" | "SWING" | "STRUCTURE";

export type StopPlan = {
  pct: number;
  price: number;
  anchor: StopAnchor;
  atrMultiple: number | null;
  reason: string;
};

export type TargetOption = {
  pct: number;
  price: number;
  targetProbability: number;
  stopProbability: number;
  neitherProbability: number;
  grossExpectedValuePct: number;
  costPct: number;
  expectedValuePct: number;
  rewardRisk: number;
  recommended: boolean;
};

export type LeveragePlan = {
  recommendedMin: number;
  recommendedMax: number;
  conservativeMin: number;
  conservativeMax: number;
  aggressiveMin: number;
  aggressiveMax: number;
  maxSafe: number;
  /** Reasons the ceiling was lowered, e.g. volatility or liquidation buffer. */
  caps: string[];
};

export type HoldingPlan = {
  minMinutes: number;
  maxMinutes: number;
  label: string;
};

export type OpportunitySide = {
  direction: OpportunityDirection;
  entryPrice: number;
  verdict: OpportunityVerdict;
  stars: number;
  /** Probability the recommended target is reached first, within the holding window. */
  profitProbability: number;
  /** Probability the recommended stop is reached first, within the holding window. */
  stopProbability: number;
  expectedValuePct: number;
  expectedValuePerHourPct: number;
  /** Expected value on margin at the recommended leverage. */
  marginRoiPct: number;
  rewardRisk: number;
  stop: StopPlan;
  recommendedTargetPct: number;
  recommendedTargetPrice: number;
  targetRangeLabel: string;
  targets: TargetOption[];
  horizons: HorizonEstimate[];
  leverage: LeveragePlan;
  holding: HoldingPlan;
  costPct: number;
  chaseRisk: number;
  confidence: number;
  basis: EstimateBasis;
  reasons: string[];
  warnings: string[];
};

export type OpportunityRow = {
  symbol: string;
  display: string;
  venue: CandleVenue;
  lastPrice: number;
  change24hPct: number | null;
  turnoverUsd: number | null;
  atrPct: number;
  rsi: number | null;
  volumeRatio: number | null;
  fundingRatePct: number | null;
  openInterestUsd: number | null;
  /** Signed taker flow over the last 4h, -1..1. Null when the venue omits it. */
  orderFlowDelta: number | null;
  trend: "UP" | "DOWN" | "FLAT";
  sampleSize: number;
  effectiveSampleSize: number;
  long: OpportunitySide | null;
  short: OpportunitySide | null;
  /** Side with the better expected value per hour. */
  bestDirection: OpportunityDirection | null;
  notes: string[];
};

export type BtcRegime = {
  trend: "UP" | "DOWN" | "FLAT";
  atrPct: number | null;
  state: "RISK_ON" | "NEUTRAL" | "RISK_OFF";
  label: string;
};

export type ExcludedSymbol = {
  symbol: string;
  reason: string;
};

export type OpportunityScanResult = {
  rows: OpportunityRow[];
  excluded: ExcludedSymbol[];
  btcRegime: BtcRegime;
  requested: number;
  evaluated: number;
  updatedAt: string;
};
