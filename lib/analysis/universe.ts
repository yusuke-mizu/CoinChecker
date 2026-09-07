import { fetchBtccUsdtSymbols } from "@/lib/exchanges/btcc";
import {
  fetchOkxSwapTickers,
  fetchOkxUsdtSwapSymbols,
} from "@/lib/market-data/okx";
import { toDisplaySymbol } from "@/lib/market-data/provider";
import { getTtlCache, setTtlCache } from "@/lib/util/ttl-cache";
import type { TickerSnapshot, UsdtSymbol } from "@/lib/types/market";

const CACHE_KEY = "universe-v1";
const CACHE_MS = 5 * 60_000;
const PRIORITY = ["BTCUSDT", "ETHUSDT", "SOLUSDT", "XRPUSDT", "DOGEUSDT"];

export type UniverseResult = {
  symbols: string[];
  tickers: Record<string, TickerSnapshot>;
  btccCount: number;
  okxCount: number;
  skippedNoOkx: number;
  source: string;
  warning: string | null;
  error: string | null;
};

function sortUniverse(symbols: string[]): string[] {
  return [...symbols].sort((a, b) => {
    const pa = PRIORITY.indexOf(a);
    const pb = PRIORITY.indexOf(b);
    if (pa !== -1 || pb !== -1) {
      if (pa === -1) return 1;
      if (pb === -1) return -1;
      return pa - pb;
    }
    return a.localeCompare(b);
  });
}

export async function loadUniverse(force = false): Promise<UniverseResult> {
  if (!force) {
    const cached = getTtlCache<UniverseResult>(CACHE_KEY);
    if (cached) return cached;
  }

  const [btccResult, okxSet, tickersResult] = await Promise.all([
    fetchBtccUsdtSymbols()
      .then((symbols) => ({ symbols, error: null as string | null }))
      .catch((error) => ({
        symbols: [] as UsdtSymbol[],
        error: error instanceof Error ? error.message : String(error),
      })),
    fetchOkxUsdtSwapSymbols(),
    fetchOkxSwapTickers()
      .then((tickers) => ({ tickers, error: null as string | null }))
      .catch((error) => ({
        tickers: {} as Record<string, TickerSnapshot>,
        error: error instanceof Error ? error.message : String(error),
      })),
  ]);

  const okxCount = okxSet.size;
  let warning: string | null = null;
  let source = "coingecko-btcc ∩ okx-usdt-swap";
  let selected: string[] = [];
  let skippedNoOkx = 0;

  if (btccResult.symbols.length > 0) {
    for (const row of btccResult.symbols) {
      if (okxSet.has(row.symbol)) {
        selected.push(row.symbol);
      } else {
        skippedNoOkx += 1;
      }
    }
  } else {
    selected = [...okxSet];
    source = "okx-usdt-swap-fallback";
    warning =
      "CoinGecko BTCC ticker list failed, so OKX USDT SWAP names are used as a fallback universe. This is not a BTCC listing.";
  }

  selected = sortUniverse(selected);
  const tickers: Record<string, TickerSnapshot> = {};
  for (const symbol of selected) {
    const snap = tickersResult.tickers[symbol];
    if (snap) tickers[symbol] = snap;
  }

  const result: UniverseResult = {
    symbols: selected,
    tickers,
    btccCount: btccResult.symbols.length,
    okxCount,
    skippedNoOkx,
    source,
    warning,
    error: btccResult.error,
  };

  return setTtlCache(CACHE_KEY, result, CACHE_MS);
}

export function toUsdtSymbol(symbol: string): UsdtSymbol {
  const compact = symbol.replace(/[-_/]/g, "").toUpperCase();
  return {
    symbol: compact,
    base: compact.endsWith("USDT") ? compact.slice(0, -4) : compact,
    quote: "USDT",
    display: toDisplaySymbol(compact),
    sourceId: "universe",
    lastPrice: null,
    volume: null,
  };
}
