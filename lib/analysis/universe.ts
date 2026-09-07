import { fetchBtccUsdtSymbols } from "@/lib/exchanges/btcc";
import {
  fetchOkxOpenInterest,
  fetchOkxSwapTickers,
  fetchOkxUsdtMPerpetuals,
} from "@/lib/market-data/okx";
import { toDisplaySymbol } from "@/lib/market-data/provider";
import { getTtlCache, setTtlCache } from "@/lib/util/ttl-cache";
import type { PerpetualContract, TickerSnapshot, UsdtSymbol } from "@/lib/types/market";

const CACHE_KEY = "universe-usdtm-v1";
const CACHE_MS = 5 * 60_000;
const PRIORITY = ["BTCUSDT", "ETHUSDT", "SOLUSDT", "XRPUSDT", "DOGEUSDT"];

export type UniverseResult = {
  symbols: string[];
  tickers: Record<string, TickerSnapshot>;
  contracts: Record<string, PerpetualContract>;
  openInterest: Record<string, number>;
  btccCount: number;
  okxCount: number;
  skippedNoOkx: number;
  skippedSpotOrNonPerp: number;
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

  const [btccResult, contracts, tickersResult, oiResult] = await Promise.all([
    fetchBtccUsdtSymbols()
      .then((symbols) => ({ symbols, error: null as string | null }))
      .catch((error) => ({
        symbols: [] as UsdtSymbol[],
        error: error instanceof Error ? error.message : String(error),
      })),
    fetchOkxUsdtMPerpetuals(),
    fetchOkxSwapTickers()
      .then((tickers) => ({ tickers, error: null as string | null }))
      .catch((error) => ({
        tickers: {} as Record<string, TickerSnapshot>,
        error: error instanceof Error ? error.message : String(error),
      })),
    fetchOkxOpenInterest()
      .then((openInterest) => openInterest)
      .catch(() => ({}) as Record<string, number>),
  ]);

  const okxSet = new Set(Object.keys(contracts));
  const okxCount = okxSet.size;
  let warning: string | null = null;
  let source = "coingecko-btcc ∩ okx-usdt-m-linear-swap";
  let selected: string[] = [];
  let skippedNoOkx = 0;
  const skippedSpotOrNonPerp = 0;

  if (btccResult.symbols.length > 0) {
    for (const row of btccResult.symbols) {
      if (okxSet.has(row.symbol)) {
        selected.push(row.symbol);
      } else {
        skippedNoOkx += 1;
      }
    }
    warning =
      "CoinGecko BTCC tickers do not reliably label Spot vs USDT-M Perpetual. Names that are not live OKX USDT-margined linear SWAP are excluded, so scoring uses perpetual OHLCV only. BTCC official futures listing still requires authenticated TradeOpenAPI.";
  } else {
    selected = [...okxSet];
    source = "okx-usdt-m-linear-swap-fallback";
    warning =
      "CoinGecko BTCC ticker list failed, so OKX USDT-M linear SWAP names are used. This is not a BTCC listing.";
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
    contracts,
    openInterest: oiResult,
    btccCount: btccResult.symbols.length,
    okxCount,
    skippedNoOkx,
    skippedSpotOrNonPerp,
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
    contractType: "USDT-M Perpetual",
    marginAsset: "USDT",
    settlement: "Perpetual",
    maxLeverage: null,
    instId: null,
  };
}
