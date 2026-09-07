import type { Candle, CoreTimeframe, TickerSnapshot, UsdtSymbol } from "@/lib/types/market";

export type MarketDataProvider = {
  id: string;
  fetchUsdtSymbols(): Promise<UsdtSymbol[]>;
  fetchOhlcv(
    symbol: string,
    timeframe: CoreTimeframe | "5m",
    limit: number,
  ): Promise<Candle[]>;
  fetchTicker(symbol: string): Promise<TickerSnapshot>;
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
