import type { CoreTimeframe, DataIssueCode, TickerSnapshot } from "./market";

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
    volume: number;
    momentum: number;
    timing: number;
  };
  items: ScoreBreakdownItem[];
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
};

export type MarketRiskLevel = "LOW" | "MODERATE" | "ELEVATED" | "HIGH";

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
};
