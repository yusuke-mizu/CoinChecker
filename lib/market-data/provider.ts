import type {
  Candle,
  CoreTimeframe,
  PerpetualContract,
  SourceAttribution,
  TickerSnapshot,
  UsdtSymbol,
} from "@/lib/types/market";
import type { CandleVenue } from "@/lib/types/venue";

export type SymbolProvider = {
  id: string;
  discoverSymbols(): Promise<UsdtSymbol[]>;
};

export type OiPoint = {
  ts: number;
  oi: number;
  oiUsd: number | null;
};

export type FundingSnapshot = {
  rate: number | null;
  nextFundingTime: number | null;
  history: number[];
};

export type SourcedResult<T> = {
  data: T;
  source: SourceAttribution;
};

export type MarketDataProvider = {
  id: string;
  venue: CandleVenue;
  fetchContracts(): Promise<Record<string, PerpetualContract>>;
  fetchOhlcv(
    symbol: string,
    timeframe: CoreTimeframe | "5m",
    limit: number,
  ): Promise<Candle[]>;
  fetchTickers(): Promise<Record<string, TickerSnapshot>>;
};

export type OpenInterestProvider = {
  id: string;
  venue: CandleVenue;
  fetchHistory5m(symbol: string, limit?: number): Promise<OiPoint[]>;
};

export type FundingProvider = {
  id: string;
  venue: CandleVenue;
  fetchFunding(symbol: string): Promise<FundingSnapshot>;
};

export function toDisplaySymbol(symbol: string): string {
  const compact = symbol.replace(/[-_]/g, "").toUpperCase();
  if (compact.endsWith("USDT") && compact.length > 4) {
    return `${compact.slice(0, -4)}/USDT`;
  }
  return symbol.toUpperCase();
}

export function toCompactUsdt(symbol: string): string {
  return symbol.replace(/[-_/]/g, "").toUpperCase();
}

export function createMarketDataProvider(
  impl: MarketDataProvider,
): MarketDataProvider {
  return impl;
}
