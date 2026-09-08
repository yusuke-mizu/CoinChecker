export const TIMEFRAMES = ["4h", "1h", "15m", "5m"] as const;
export type Timeframe = (typeof TIMEFRAMES)[number];
export type CoreTimeframe = "4h" | "1h" | "15m";

export type Candle = {
  openTime: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  closeTime: number;
};

export type TickerSnapshot = {
  last: number;
  change24hPct: number | null;
  high24h: number | null;
  low24h: number | null;
  volume24h: number | null;
};

export type AvailabilityStage =
  | "DISCOVERED"
  | "MARKET_DATA_AVAILABLE"
  | "SCORING_AVAILABLE";

export type ListingVerification =
  | "OFFICIAL_CONFIRMED"
  | "THIRD_PARTY_CONFIRMED"
  | "DISCOVERED";

export type ContractClassification = "USDT-M PERPETUAL" | "UNKNOWN";

export type ProviderId =
  | "btcc"
  | "coingecko"
  | "okx"
  | "bybit"
  | "binance"
  | "unknown";

export type SourceAttribution = {
  provider: ProviderId;
  label: string;
  observedAt: string;
  url?: string;
  note?: string;
};

export type FeedProvenance = {
  listing: SourceAttribution[];
  ticker: SourceAttribution | null;
  ohlcv: SourceAttribution | null;
  oi: SourceAttribution | null;
  funding: SourceAttribution | null;
};

export type AggregateDataQuality = {
  score: number;
  band: "HIGH" | "MEDIUM" | "LOW" | "NONE";
  validTimeframes: CoreTimeframe[];
  reasons: string[];
};

export type UsdtSymbol = {
  symbol: string;
  base: string;
  quote: "USDT";
  display: string;
  sourceId: string;
  lastPrice: number | null;
  volume: number | null;
  contractType?: "USDT-M Perpetual";
  marginAsset?: "USDT";
  settlement?: "Perpetual";
  maxLeverage?: number | null;
  instId?: string | null;
};

export type PerpetualContract = {
  symbol: string;
  display: string;
  contractType: "USDT-M Perpetual";
  quoteAsset: "USDT";
  marginAsset: "USDT";
  settlement: "Perpetual";
  maxLeverage: number | null;
  instId: string;
};

export type BtccCandidate = {
  symbol: string;
  display: string;
  listingVerification: ListingVerification;
  contract: ContractClassification;
  availability: AvailabilityStage;
  marketVenue: import("./venue").CandleVenue | null;
  ticker: TickerSnapshot | null;
  complementContract: PerpetualContract | null;
  sources: FeedProvenance;
  dataQuality: AggregateDataQuality;
  discoveredAt: string;
  discoveryWarnings: string[];
};

export type DataIssueCode =
  | "DATA_ERROR"
  | "DATA_INSUFFICIENT"
  | "RATE_LIMIT"
  | "TIMEOUT"
  | "STALE"
  | "INVALID";

export type DataQuality = {
  ok: boolean;
  code?: DataIssueCode;
  reasons: string[];
  candleCount: number;
  lastOpenTime: number | null;
};

export type TimeframeBundle = {
  timeframe: CoreTimeframe;
  candles: Candle[];
  quality: DataQuality;
};
