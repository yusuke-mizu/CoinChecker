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
  timingThreshold: number;
  topN: number | null;
  durationHours: TrackingDurationHours;
  portfolioProtectionCount: number;
};

export type SignalScoreSnapshot = {
  entry: number;
  oppositeEntry: number;
  timing: number;
  oppositeTiming: number;
  trend: number;
  range: number;
  drift: number;
  driftSide: "up" | "down" | "none";
  reversal: number;
  futures: number | null;
  dataQuality: number;
  exitAlert: number;
  price: number;
  btcCorrelation: number | null;
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
};

export type SignalStoreDocument = {
  version: 1;
  settings: SignalSettings;
  signals: TrackedSignal[];
  updatedAt: string;
};

export type SignalSetCandidate = {
  name: "BALANCED SET";
  members: TrackedSignal[];
  status: "ACTIVE" | "WATCH" | "HIGH RISK";
  takeProfitRisk: "LOW" | "MEDIUM" | "HIGH";
  exitRisk: "LOW" | "MEDIUM" | "HIGH";
  correlationRisk: "LOW" | "MEDIUM" | "HIGH";
  profitProtection: boolean;
};
