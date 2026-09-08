import {
  fetchOkxOhlcv,
  fetchOkxSwapTickers,
  fetchOkxUsdtMPerpetuals,
} from "@/lib/market-data/okx";
import {
  createMarketDataProvider,
  type MarketDataProvider,
} from "@/lib/market-data/provider";

export const okxSwapProvider: MarketDataProvider = createMarketDataProvider({
  id: "okx-swap-public",
  venue: "okx",
  fetchContracts: fetchOkxUsdtMPerpetuals,
  fetchOhlcv: fetchOkxOhlcv,
  fetchTickers: fetchOkxSwapTickers,
});
