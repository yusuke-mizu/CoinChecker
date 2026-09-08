import type { SignalLabel, SymbolAnalysis } from "./scoring";
import type { CandleVenue } from "./venue";

export type SignalDirection = "LONG" | "SHORT";
export type SignalStatus =
  | "NEW"
  | "ACTIVE"
  | "WEAKENING"
  | "TAKE_PROFIT_WATCH"
  | "EXIT_WATCH"
  | "STOP_LOSS_WATCH"
  | "INVALIDATED"
  | "EXPIRED";
export type SignalAlertPriority =
  | "STOP_LOSS"
  | "STRONG_EXIT"
  | "STRONG_TAKE_PROFIT"
  | "TAKE_PROFIT"
  | "REVERSAL"
  | "WEAKENING"
  | "ACTIVE";
export type TrackingDurationHours = 6 | 12 | 24 | 48 | 168;

export type SignalSettings = {
  enabled: boolean;
  entryThreshold: number;
  strongEntryThreshold: number;
  watchEntryThreshold: number;
  timingThreshold: number;
  topN: number | null;
  durationHours: TrackingDurationHours;
  portfolioProtectionCount: number;
  setLeverage: number;
  hardStopPct: number;
};

export type SignalScoreSnapshot = {
  scoreModel: "legacy-v1" | "expectancy-v1";
  entry: number;
  oppositeEntry: number;
  timing: number;
  oppositeTiming: number;
  trend: number;
  expectedMove: number;
  potentialRewardPct: number;
  potentialRiskPct: number;
  rewardRisk: number;
  chasingPenalty: number;
  entryType: string;
  entryDecision: string;
  range: number;
  drift: number;
  driftSide: "up" | "down" | "none";
  reversal: number;
  futures: number | null;
  dataQuality: number;
  exitAlert: number;
  price: number;
  btcCorrelation: number | null;
  btcBeta: number | null;
  confidence: SymbolAnalysis["confidence"];
  marketVenue: CandleVenue | null;
  signalLabel: SignalLabel;
  observedAt: string;
  reasons: string[];
};

export type SignalObservation = {
  symbol: string;
  display: string;
  direction: SignalDirection;
  isDominant: boolean;
  scoringAvailable: boolean;
  regime: string | null;
  snapshot: SignalScoreSnapshot | null;
};

export type SignalEvent = {
  at: string;
  from: SignalStatus | null;
  to: SignalStatus;
};

export type SignalPerformanceHorizon = "1h" | "4h" | "12h" | "24h";
export type SignalPerformanceCheckpoint = {
  horizon: SignalPerformanceHorizon;
  targetAt: string;
  sampledAt: string | null;
  lagMinutes: number | null;
  sampledPrice: number | null;
  returnPct: number | null;
  state: "PENDING" | "OBSERVED" | "MISSED";
};

export type TrackedSignal = {
  id: string;
  symbol: string;
  display: string;
  direction: SignalDirection;
  createdAt: string;
  lastQualifiedAt: string;
  lastEvaluatedAt: string;
  expiresAt: string;
  evaluationState: "AVAILABLE" | "DATA_UNAVAILABLE";
  baseline: SignalScoreSnapshot;
  current: SignalScoreSnapshot;
  peakFavorablePct: number;
  priceChangePct: number;
  deteriorationScore: number;
  takeProfitScore: number;
  status: SignalStatus;
  alertPriority: SignalAlertPriority;
  events: SignalEvent[];
  performance: SignalPerformanceCheckpoint[];
};

export type SignalStoreDocument = {
  version: 1;
  settings: SignalSettings;
  signals: TrackedSignal[];
  updatedAt: string;
};

export type SignalSetCandidate = {
  name: "ATTACK SET" | "BALANCED SET" | "DEFENSIVE SET";
  members: TrackedSignal[];
  status: "ACTIVE" | "WATCH" | "HIGH RISK";
  takeProfitRisk: "LOW" | "MEDIUM" | "HIGH";
  exitRisk: "LOW" | "MEDIUM" | "HIGH";
  correlationRisk: "LOW" | "MEDIUM" | "HIGH";
  profitProtection: boolean;
  expectedRewardPct: number;
  expectedRiskPct: number;
  rewardRisk: number;
  longExposurePct: number;
  shortExposurePct: number;
  netExposurePct: number;
  reversalRisk: number;
  dataQuality: number;
  setScore: number;
  stressLevel: "LOW" | "MEDIUM" | "HIGH";
  stressEstimatedPct: number | null;
  leverage: number;
  riskBudgetScore: number;
  effectiveDiversification: number;
  compoundingQuality: number;
  alerts: Array<
    | "CAPITAL PRESERVATION"
    | "PORTFOLIO RISK RISING"
    | "PORTFOLIO TAKE PROFIT WATCH"
    | "PORTFOLIO DEFENSE"
  >;
};
