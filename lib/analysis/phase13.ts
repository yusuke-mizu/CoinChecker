import { fetchBtccUsdtSymbols } from "@/lib/exchanges/btcc";
import { loadMarketEnv } from "@/lib/analysis/market-env";
import { DATA_SOURCE_NOTES, DISCLAIMER } from "@/lib/analysis/notes";
import { failedCandidateAnalysis } from "@/lib/analysis/listed-only";
import type { UsdtSymbol } from "@/lib/types/market";
import type { MarketEnvSnapshot, SymbolAnalysis } from "@/lib/types/scoring";

export type Phase13Result = {
  phase: "1-3";
  disclaimer: string;
  dataSources: {
    symbols: string;
    ohlcv: string;
    notes: string[];
  };
  symbols: {
    count: number;
    items: UsdtSymbol[];
    source: string;
    warning: string | null;
    error: string | null;
  };
  market: MarketEnvSnapshot;
  focus: SymbolAnalysis;
};

export async function runPhase13(): Promise<Phase13Result> {
  const [btcc, market] = await Promise.all([
    fetchBtccUsdtSymbols()
      .then((items) => ({
        items,
        error: null as string | null,
      }))
      .catch((error) => ({
        items: [] as UsdtSymbol[],
        error: error instanceof Error ? error.message : String(error),
      })),
    loadMarketEnv(),
  ]);

  const warning =
    btcc.items.length === 0
      ? "BTCC USDT list was empty or failed. BTC OHLCV/scoring still uses OKX public SWAP candles."
      : null;

  return {
    phase: "1-3",
    disclaimer: DISCLAIMER,
    dataSources: {
      symbols: "coingecko-btcc-tickers",
      ohlcv: "okx-public-swap-candles",
      notes: DATA_SOURCE_NOTES,
    },
    symbols: {
      count: btcc.items.length,
      items: btcc.items,
      source: btcc.items.length ? "coingecko-btcc-tickers" : "unavailable",
      warning,
      error: btcc.error,
    },
    market,
    focus:
      market.btc ??
      failedCandidateAnalysis({
        symbol: "BTCUSDT",
        ticker: null,
        venue: "okx",
        error: "BTC analysis missing",
      }),
  };
}
