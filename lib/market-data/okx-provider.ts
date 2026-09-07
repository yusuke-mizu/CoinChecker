import {
  fetchOkxOhlcv,
  fetchOkxTicker,
  fetchOkxUsdtSwapSymbols,
} from "@/lib/market-data/okx";
import {
  createMarketDataProvider,
  toDisplaySymbol,
  type MarketDataProvider,
} from "@/lib/market-data/provider";
import type { UsdtSymbol } from "@/lib/types/market";

export const okxSwapProvider: MarketDataProvider = createMarketDataProvider({
  id: "okx-swap-public",
  async fetchUsdtSymbols(): Promise<UsdtSymbol[]> {
    const set = await fetchOkxUsdtSwapSymbols();
    return [...set]
      .sort()
      .map((symbol) => ({
        symbol,
        base: symbol.endsWith("USDT") ? symbol.slice(0, -4) : symbol,
        quote: "USDT" as const,
        display: toDisplaySymbol(symbol),
        sourceId: "okx-usdt-swap",
        lastPrice: null,
        volume: null,
      }));
  },
  fetchOhlcv: fetchOkxOhlcv,
  fetchTicker: fetchOkxTicker,
});
