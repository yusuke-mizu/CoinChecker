export type AttackLevel = "ATTACK" | "NORMAL" | "DEFEND";
export type TradeRiskTier = "LOW RISK" | "MEDIUM RISK" | "HIGH RISK" | "EXTREME RISK";
export type BreakoutStatus =
  | "NOT_APPLICABLE"
  | "WAITING"
  | "CONFIRMED"
  | "CONFIRMED_RETEST"
  | "CONFIRMED_CHASING_RISK";

export type EntryVerdict =
  | "ENTRY NOW"
  | "WAIT FOR PULLBACK"
  | "WAIT FOR BREAKOUT"
  | "WAIT"
  | "NO ENTRY"
  | "NO ENTRY / POOR R:R";

export type HoldingWindow =
  | "5-15m"
  | "15-30m"
  | "30m-1h"
  | "1-2h"
  | "2-4h"
  | "4-12h"
  | "12-24h";

/** Recommended levels derived from current market structure. Not a prediction. */
export type TradeLevels = {
  entryReference: number;
  stopLoss: number;
  stopLossPct: number;
  target1: number;
  target1Pct: number;
  target2: number;
  target2Pct: number;
  rewardRisk: number;
};

export type LeverageGuidance = {
  min: number;
  max: number;
  /** Loss on margin if the structure stop is reached at `max` leverage. */
  marginLossAtStopPct: number;
  /** Gain on margin if TP1 is reached at `max` leverage. */
  marginRoiAtTarget1Pct: number;
  warning: string | null;
};

export type TradePlan = {
  direction: "LONG" | "SHORT";
  entryZoneLow: number;
  entryZoneHigh: number;
  entryLocation:
    | "ENTRY NOW / GOOD LOCATION"
    | "CHASE RISK / WAIT FOR PULLBACK"
    | "WAIT / SETUP DEVELOPING";
  entryVerdict: EntryVerdict;
  structureStop: number;
  structureStopPct: number;
  hardStop: number;
  hardStopPct: number;
  invalidationLevel: number;
  breakoutLevel: number | null;
  breakoutStatus: BreakoutStatus;
  breakoutRequirements: string[];
  target1: number;
  target2: number;
  levels: TradeLevels;
  potentialRewardPct: number;
  potentialRiskPct: number;
  rewardRisk: number;
  expectedMove15mPct: number | null;
  expectedMove1hPct: number | null;
  expectedMove4hPct: number | null;
  leverage: LeverageGuidance;
  holdingWindow: HoldingWindow;
  /** Model-side expectancy in percent of position size. Not a measured win rate. */
  estimatedExpectedValuePct: number;
  estimatedTargetProbability: number;
  riskTier: TradeRiskTier;
  highRiskHighReward: boolean;
  overheatScore: number;
  oversoldScore: number;
  pressureState:
    | "OVERHEATED"
    | "OVERSOLD + REVERSAL"
    | "OVERSOLD + CONTINUING DOWNTREND"
    | "HEALTHY PULLBACK"
    | "NEUTRAL";
  compoundingQuality: number;
  confidence: "HIGH" | "MEDIUM" | "LOW";
  confidenceScore: number;
  structureBeyondHardStop: boolean;
  thesis: {
    whyTrade: string;
    whyNow: string;
    mustHappen: string;
    invalidation: string;
    takeProfit: string;
    mainRisk: string;
  };
};

export type MarketDecision = {
  attackLevel: AttackLevel;
  score: number;
  shock: boolean;
  shockScore: number;
  marketBreadthPct: number | null;
  highOpportunityCount: number;
  averageExpectedMove: number | null;
  averageCorrelation: number | null;
  capitalPreservation: boolean;
  reasons: string[];
  recommendedSet: "ATTACK SET" | "BALANCED SET" | "DEFENSIVE SET";
  optionalSet: "ATTACK SET" | "BALANCED SET" | "DEFENSIVE SET" | null;
  avoid: string;
  advice: string;
};
