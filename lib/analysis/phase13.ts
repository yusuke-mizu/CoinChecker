import { fetchBtccUsdtSymbols } from "@/lib/exchanges/btcc";
import { loadMarketEnv } from "@/lib/analysis/market-env";
import { DATA_SOURCE_NOTES, DISCLAIMER } from "@/lib/analysis/notes";
import { DECISION_EMPTY } from "@/lib/analysis/listed-only";
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
    loadMarketEnv(true),
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
      ({
        symbol: "BTCUSDT",
        display: "BTC/USDT",
        status: "DATA_INSUFFICIENT",
        ticker: null,
        long: null,
        short: null,
        difference: null,
        bias: null,
        signal: "DATA INSUFFICIENT",
        indicators: {},
        updatedAt: new Date().toISOString(),
        notes: ["BTC analysis missing"],
        dataSource: "okx-swap-public",
        btcCorrelation: 1,
        rankLong: null,
        rankShort: null,
        reversal: null,
        futures: null,
        ...DECISION_EMPTY,
        contract: {
          contractType: "USDT-M Perpetual",
          quoteAsset: "USDT",
          marginAsset: "USDT",
          settlement: "Perpetual",
          maxLeverage: null,
        },
      } satisfies SymbolAnalysis),
  };
}
