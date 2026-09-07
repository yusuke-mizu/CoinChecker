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
import type { Candle, CoreTimeframe, PerpetualContract, TickerSnapshot } from "@/lib/types/market";
import type { CandleVenue } from "@/lib/types/venue";

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
  const [okx, bybit, binance] = await Promise.all([
    fetchOkxSwapTickers().catch(() => ({}) as Record<string, TickerSnapshot>),
    fetchBybitTickers().catch(() => ({}) as Record<string, TickerSnapshot>),
    fetchBinanceTickers().catch(() => ({}) as Record<string, TickerSnapshot>),
  ]);
  return { ...binance, ...bybit, ...okx };
}

export async function fetchVenueOhlcv(
  venue: CandleVenue,
  symbol: string,
  timeframe: CoreTimeframe | "5m",
  limit: number,
): Promise<Candle[]> {
  if (venue === "bybit") return fetchBybitOhlcv(symbol, timeframe, limit);
  if (venue === "binance") return fetchBinanceOhlcv(symbol, timeframe, limit);
  return fetchOkxOhlcv(symbol, timeframe, limit);
}

export async function fetchVenueTicker(venue: CandleVenue, symbol: string): Promise<TickerSnapshot> {
  if (venue === "okx") return fetchOkxTicker(symbol);
  const all = venue === "bybit" ? await fetchBybitTickers() : await fetchBinanceTickers();
  const snap = all[toCompact(symbol)];
  if (!snap) throw new Error(`Ticker missing on ${venue} for ${symbol}`);
  return snap;
}

export async function fetchVenueOiHistory(venue: CandleVenue, symbol: string, limit = 100) {
  if (venue === "bybit") return fetchBybitOiHistory5m(symbol, limit);
  if (venue === "binance") return fetchBinanceOiHistory5m(symbol, limit);
  return fetchOkxOiHistory5m(symbol, limit);
}

export async function fetchVenueFunding(venue: CandleVenue, symbol: string) {
  if (venue === "bybit") return fetchBybitFunding(symbol);
  if (venue === "binance") return fetchBinanceFunding(symbol);
  return fetchOkxFunding(symbol);
}

function toCompact(symbol: string): string {
  return symbol.replace(/[-_/]/g, "").toUpperCase();
}

export const VENUE_LABEL: Record<CandleVenue, string> = {
  okx: "OKX USDT-M",
  bybit: "Bybit USDT-M",
  binance: "Binance USDT-M",
};
