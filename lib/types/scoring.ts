import type { CoreTimeframe, DataIssueCode, TickerSnapshot } from "./market";
import type { CandleVenue } from "./venue";

export type TrendLabel =
  | "Strong Bullish"
  | "Bullish"
  | "Range"
  | "Bearish"
  | "Strong Bearish"
  | "Unknown";

export type MacdBias = "Bullish" | "Bearish" | "Neutral";

export type TimeframeIndicators = {
  timeframe: CoreTimeframe;
  ema20: number | null;
  ema50: number | null;
  ema200: number | null;
  rsi: number | null;
  macd: number | null;
  macdSignal: number | null;
  macdHist: number | null;
  macdBias: MacdBias;
  adx: number | null;
  plusDi: number | null;
  minusDi: number | null;
  volumeRatio: number | null;
  structure: "HH_HL" | "LH_LL" | "MIXED" | "UNKNOWN";
  trend: TrendLabel;
  lastClose: number | null;
  prevClose: number | null;
  divergence: "bearish" | "bullish" | "none";
  upperWick: number | null;
  lowerWick: number | null;
};

export type ScoreBreakdownItem = {
  key: string;
  label: string;
  points: number;
  max: number;
  reason: string;
};

export type DirectionScore = {
  total: number;
  breakdown: {
    market: number;
    trend4h: number;
    trend1h: number;
    trend15m: number;
    momentum: number;
    volume: number;
    priceAction: number;
    btcAlign: number;
    futures: number;
  };
  items: ScoreBreakdownItem[];
  renormalized: boolean;
};

export type SignalLabel =
  | "VERY STRONG LONG CANDIDATE"
  | "STRONG LONG CANDIDATE"
  | "LONG CANDIDATE"
  | "WATCH LONG"
  | "VERY STRONG SHORT CANDIDATE"
  | "STRONG SHORT CANDIDATE"
  | "SHORT CANDIDATE"
  | "WATCH SHORT"
  | "SHORT-TERM REVERSAL CANDIDATE"
  | "NO SIGNAL"
  | "CONFLICT / NO SIGNAL"
  | "DATA INSUFFICIENT"
  | "DATA ERROR";

export type BiasLabel = "LONG優勢" | "SHORT優勢" | "方向感なし / 見送り";

export type SymbolAnalysis = {
  symbol: string;
  display: string;
  status: "ok" | DataIssueCode;
  ticker: TickerSnapshot | null;
  long: DirectionScore | null;
  short: DirectionScore | null;
  difference: number | null;
  bias: BiasLabel | null;
  signal: SignalLabel;
  indicators: Partial<Record<CoreTimeframe, TimeframeIndicators>>;
  updatedAt: string;
  notes: string[];
  dataSource: string;
  btcCorrelation: number | null;
  rankLong: number | null;
  rankShort: number | null;
  reversal: ReversalAssessment | null;
  futures: FuturesPositioning | null;
  contract: {
    contractType: "USDT-M Perpetual";
    quoteAsset: "USDT";
    marginAsset: "USDT";
    settlement: "Perpetual";
    maxLeverage: number | null;
  } | null;
};

export type ReversalSide = "BULLISH REVERSAL" | "BEARISH REVERSAL" | "NO REVERSAL";

export type ReversalAssessment = {
  bullish: number;
  bearish: number;
  signal: ReversalSide;
  reasons: string[];
  itemsBull: ScoreBreakdownItem[];
  itemsBear: ScoreBreakdownItem[];
};

export type OiChangeBand = "NORMAL" | "NOTICE" | "HIGH" | "EXTREME" | "UNAVAILABLE";

export type PositioningStructure =
  | "LONG BUILDUP"
  | "SHORT BUILDUP"
  | "LONG LIQUIDATION CANDIDATE"
  | "SHORT COVERING / SQUEEZE CANDIDATE"
  | "LONG OVERCROWDED"
  | "SHORT OVERCROWDED"
  | "NEUTRAL"
  | "UNAVAILABLE";

export type FuturesPositioning = {
  availableOi: boolean;
  availableFunding: boolean;
  currentOi: number | null;
  oiUsd: number | null;
  oiChange15mPct: number | null;
  oiChange1hPct: number | null;
  oiChange4hPct: number | null;
  oiAccel: number | null;
  oiBand: OiChangeBand;
  oiZScore: number | null;
  oiPercentile: number | null;
  fundingRate: number | null;
  fundingNextTime: number | null;
  fundingChange: number | null;
  fundingPercentile: number | null;
  fundingZScore: number | null;
  priceChange1hPct: number | null;
  structure: PositioningStructure;
  narrativeJa: string;
  score: number;
  oiMomentum: number;
  fundingBias: number;
  priceOi: number;
  liquidation: number;
  flags: string[];
  longPoints: number;
  shortPoints: number;
  longReason: string;
  shortReason: string;
};

export type ExitAlertLevel = "NORMAL" | "WATCH" | "CAUTION" | "HIGH ALERT" | "CRITICAL";
export type ExitHierarchy = "NONE" | "LEVEL 1" | "LEVEL 2" | "LEVEL 3" | "LEVEL 4";

export type ExitAlert = {
  score: number;
  level: ExitAlertLevel;
  hierarchy: ExitHierarchy;
  reasons: string[];
  headline: string;
};

export type MarketRiskLevel =
  | "NORMAL"
  | "CAUTION"
  | "HIGH RISK"
  | "VERY HIGH RISK"
  | "EXTREME";

export type MarketRisk = {
  score: number;
  level: MarketRiskLevel;
  reasons: string[];
  warning: string;
};

export type MarketEnvSnapshot = {
  btc: SymbolAnalysis | null;
  btc4h: TimeframeIndicators | null;
  btc1hCloses: number[];
  dominancePct: number | null;
  dominanceNote: string;
  updatedAt: string;
  notes: string[];
};

export type SharedMarketContext = {
  btc4h: TimeframeIndicators | null;
  btc1hCloses: number[];
  dominancePct: number | null;
  tickers?: Record<string, TickerSnapshot>;
  venues?: Record<string, CandleVenue>;
};
