import {
  fetchBinanceFunding,
  fetchBinanceOiHistory5m,
  fetchBinanceOhlcv,
  fetchBinanceTickers,
  fetchBinanceUsdtMPerpetuals,
} from "@/lib/market-data/binance";
import {
  fetchBybitFunding,
  fetchBybitOiHistory5m,
  fetchBybitOhlcv,
  fetchBybitTickers,
  fetchBybitUsdtMPerpetuals,
} from "@/lib/market-data/bybit";
import {
  fetchOkxFunding,
  fetchOkxOiHistory5m,
  fetchOkxOhlcv,
  fetchOkxSwapTickers,
  fetchOkxTicker,
  fetchOkxUsdtMPerpetuals,
} from "@/lib/market-data/okx";
import type {
  Candle,
  CoreTimeframe,
  PerpetualContract,
  SourceAttribution,
  TickerSnapshot,
} from "@/lib/types/market";
import type {
  FundingProvider,
  MarketDataProvider,
  OpenInterestProvider,
} from "@/lib/market-data/provider";
import type { CandleVenue } from "@/lib/types/venue";

export const MARKET_DATA_PROVIDERS: Record<CandleVenue, MarketDataProvider> = {
  okx: {
    id: "okx-usdt-m-public",
    venue: "okx",
    fetchContracts: fetchOkxUsdtMPerpetuals,
    fetchOhlcv: fetchOkxOhlcv,
    fetchTickers: fetchOkxSwapTickers,
  },
  bybit: {
    id: "bybit-usdt-m-public",
    venue: "bybit",
    fetchContracts: fetchBybitUsdtMPerpetuals,
    fetchOhlcv: fetchBybitOhlcv,
    fetchTickers: fetchBybitTickers,
  },
  binance: {
    id: "binance-usdt-m-public",
    venue: "binance",
    fetchContracts: fetchBinanceUsdtMPerpetuals,
    fetchOhlcv: fetchBinanceOhlcv,
    fetchTickers: fetchBinanceTickers,
  },
};

export const OPEN_INTEREST_PROVIDERS: Record<CandleVenue, OpenInterestProvider> = {
  okx: { id: "okx-oi-public", venue: "okx", fetchHistory5m: fetchOkxOiHistory5m },
  bybit: { id: "bybit-oi-public", venue: "bybit", fetchHistory5m: fetchBybitOiHistory5m },
  binance: {
    id: "binance-oi-public",
    venue: "binance",
    fetchHistory5m: fetchBinanceOiHistory5m,
  },
};

export const FUNDING_PROVIDERS: Record<CandleVenue, FundingProvider> = {
  okx: { id: "okx-funding-public", venue: "okx", fetchFunding: fetchOkxFunding },
  bybit: { id: "bybit-funding-public", venue: "bybit", fetchFunding: fetchBybitFunding },
  binance: {
    id: "binance-funding-public",
    venue: "binance",
    fetchFunding: fetchBinanceFunding,
  },
};

export async function fetchAllVenueContracts(): Promise<{
  okx: Record<string, PerpetualContract>;
  bybit: Record<string, PerpetualContract>;
  binance: Record<string, PerpetualContract>;
}> {
  const [okx, bybit, binance] = await Promise.all([
    fetchOkxUsdtMPerpetuals().catch(() => ({}) as Record<string, PerpetualContract>),
    fetchBybitUsdtMPerpetuals().catch(() => ({}) as Record<string, PerpetualContract>),
    fetchBinanceUsdtMPerpetuals().catch(() => ({}) as Record<string, PerpetualContract>),
  ]);
  return { okx, bybit, binance };
}

export function pickVenue(
  symbol: string,
  coverage: {
    okx: Record<string, PerpetualContract>;
    bybit: Record<string, PerpetualContract>;
    binance: Record<string, PerpetualContract>;
  },
): CandleVenue | null {
  if (coverage.okx[symbol]) return "okx";
  if (coverage.bybit[symbol]) return "bybit";
  if (coverage.binance[symbol]) return "binance";
  return null;
}

export function mergeContracts(
  coverage: {
    okx: Record<string, PerpetualContract>;
    bybit: Record<string, PerpetualContract>;
    binance: Record<string, PerpetualContract>;
  },
  venues: Record<string, CandleVenue>,
): Record<string, PerpetualContract> {
  const out: Record<string, PerpetualContract> = {};
  for (const [symbol, venue] of Object.entries(venues)) {
    const row = coverage[venue][symbol];
    if (row) out[symbol] = row;
  }
  return out;
}

export async function fetchMergedTickers(): Promise<Record<string, TickerSnapshot>> {
  return (await fetchSourcedTickers()).tickers;
}

export async function fetchSourcedTickers(): Promise<{
  tickers: Record<string, TickerSnapshot>;
  sources: Record<string, SourceAttribution>;
}> {
  const [okx, bybit, binance] = await Promise.all([
    fetchOkxSwapTickers().catch(() => ({}) as Record<string, TickerSnapshot>),
    fetchBybitTickers().catch(() => ({}) as Record<string, TickerSnapshot>),
    fetchBinanceTickers().catch(() => ({}) as Record<string, TickerSnapshot>),
  ]);
  const tickers = { ...binance, ...bybit, ...okx };
  const sources: Record<string, SourceAttribution> = {};
  for (const symbol of Object.keys(binance)) sources[symbol] = sourceForVenue("binance", "ticker");
  for (const symbol of Object.keys(bybit)) sources[symbol] = sourceForVenue("bybit", "ticker");
  for (const symbol of Object.keys(okx)) sources[symbol] = sourceForVenue("okx", "ticker");
  return { tickers, sources };
}

export async function fetchVenueOhlcv(
  venue: CandleVenue,
  symbol: string,
  timeframe: CoreTimeframe | "5m",
  limit: number,
): Promise<Candle[]> {
  return MARKET_DATA_PROVIDERS[venue].fetchOhlcv(symbol, timeframe, limit);
}

export async function fetchVenueTicker(venue: CandleVenue, symbol: string): Promise<TickerSnapshot> {
  if (venue === "okx") return fetchOkxTicker(symbol);
  const all = venue === "bybit" ? await fetchBybitTickers() : await fetchBinanceTickers();
  const snap = all[toCompact(symbol)];
  if (!snap) throw new Error(`Ticker missing on ${venue} for ${symbol}`);
  return snap;
}

export async function fetchVenueOiHistory(venue: CandleVenue, symbol: string, limit = 100) {
  return OPEN_INTEREST_PROVIDERS[venue].fetchHistory5m(symbol, limit);
}

export async function fetchVenueFunding(venue: CandleVenue, symbol: string) {
  return FUNDING_PROVIDERS[venue].fetchFunding(symbol);
}

function toCompact(symbol: string): string {
  return symbol.replace(/[-_/]/g, "").toUpperCase();
}

export const VENUE_LABEL: Record<CandleVenue, string> = {
  okx: "OKX USDT-M",
  bybit: "Bybit USDT-M",
  binance: "Binance USDT-M",
};

export function sourceForVenue(
  venue: CandleVenue,
  feed: "ticker" | "ohlcv" | "oi" | "funding",
): SourceAttribution {
  return {
    provider: venue,
    label: `${VENUE_LABEL[venue]} ${feed.toUpperCase()}`,
    observedAt: new Date().toISOString(),
    note: "BTCC公式データではなく、完全一致シンボルの補完データ",
  };
}
