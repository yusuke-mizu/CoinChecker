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
