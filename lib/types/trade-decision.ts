export type AttackLevel = "ATTACK" | "NORMAL" | "DEFEND";
export type TradeRiskTier = "LOW RISK" | "MEDIUM RISK" | "HIGH RISK";
export type BreakoutStatus =
  | "NOT_APPLICABLE"
  | "WAITING"
  | "CONFIRMED"
  | "CONFIRMED_RETEST"
  | "CONFIRMED_CHASING_RISK";

export type TradePlan = {
  direction: "LONG" | "SHORT";
  entryZoneLow: number;
  entryZoneHigh: number;
  entryLocation:
    | "ENTRY NOW / GOOD LOCATION"
    | "CHASE RISK / WAIT FOR PULLBACK"
    | "WAIT / SETUP DEVELOPING";
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
  potentialRewardPct: number;
  potentialRiskPct: number;
  rewardRisk: number;
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
