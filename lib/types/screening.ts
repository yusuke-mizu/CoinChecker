import type { CandleVenue } from "./venue";

export type TurnoverBasis = "QUOTE" | "ESTIMATED" | "UNKNOWN";

export type ScreenStage = "TICKER_ONLY" | "CANDLE_PROBED";

export type LightScreenRow = {
  symbol: string;
  display: string;
  venue: CandleVenue | null;
  stage: ScreenStage;
  last: number | null;
  turnoverUsd: number | null;
  turnoverBasis: TurnoverBasis;
  change24hPct: number | null;
  pricePosition24h: number | null;
  range24hPct: number | null;
  return1hPct: number | null;
  return15mPct: number | null;
  rsi15m: number | null;
  atrPct: number | null;
  volumeRatio: number | null;
  abnormalMove: boolean;
  liquidityScore: number;
  activityScore: number;
  setupScore: number;
  screenScore: number;
  confidencePenalty: number;
  excluded: boolean;
  notes: string[];
};

export type ScreenResult = {
  discovered: number;
  marketDataAvailable: number;
  prescreened: number;
  candleProbed: number;
  rows: LightScreenRow[];
  detailCandidates: string[];
  candleRequests: number;
  warning: string | null;
  updatedAt: string;
};
