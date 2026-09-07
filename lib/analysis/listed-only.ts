import { toCompactUsdt, toDisplaySymbol } from "@/lib/market-data/provider";
import type { TickerSnapshot } from "@/lib/types/market";
import type { SymbolAnalysis } from "@/lib/types/scoring";

export const NO_PUBLIC_PERP = "btcc-listed-no-public-perp";

export function listedWithoutPublicPerp(
  symbol: string,
  ticker: TickerSnapshot | null,
): SymbolAnalysis {
  const compact = toCompactUsdt(symbol);
  return {
    symbol: compact,
    display: toDisplaySymbol(compact),
    status: "DATA_INSUFFICIENT",
    ticker,
    long: null,
    short: null,
    difference: null,
    bias: null,
    signal: "DATA INSUFFICIENT",
    indicators: {},
    updatedAt: new Date().toISOString(),
    notes: [
      "BTCC掲載（CoinGecko）。OKX / Bybit / Binance に同名のUSDT-M先物が無いため足が取れず、採点しません。",
    ],
    dataSource: NO_PUBLIC_PERP,
    btcCorrelation: null,
    rankLong: null,
    rankShort: null,
    reversal: null,
    futures: null,
    contract: null,
  };
}
