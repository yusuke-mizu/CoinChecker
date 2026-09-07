import { fetchBtccUsdtSymbols } from "@/lib/exchanges/btcc";
import {
  fetchAllVenueContracts,
  fetchMergedTickers,
  mergeContracts,
  pickVenue,
} from "@/lib/market-data/venue-router";
import { toDisplaySymbol } from "@/lib/market-data/provider";
import { getTtlCache, setTtlCache } from "@/lib/util/ttl-cache";
import type { PerpetualContract, TickerSnapshot, UsdtSymbol } from "@/lib/types/market";
import type { CandleVenue } from "@/lib/types/venue";

const CACHE_KEY = "universe-btcc-all-listed-v1";
const CACHE_MS = 5 * 60_000;
const PRIORITY = ["BTCUSDT", "ETHUSDT", "SOLUSDT", "XRPUSDT", "DOGEUSDT"];

export type UniverseResult = {
  symbols: string[];
  tickers: Record<string, TickerSnapshot>;
  contracts: Record<string, PerpetualContract>;
  venues: Record<string, CandleVenue>;
  btccCount: number;
  skippedNoVenue: number;
  skippedNoOkx: number;
  skippedSpotOrNonPerp: number;
  source: string;
  warning: string | null;
  error: string | null;
};

function sortUniverse(symbols: string[], venues: Record<string, CandleVenue>): string[] {
  return [...symbols].sort((a, b) => {
    const pa = PRIORITY.indexOf(a);
    const pb = PRIORITY.indexOf(b);
    if (pa !== -1 || pb !== -1) {
      if (pa === -1) return 1;
      if (pb === -1) return -1;
      return pa - pb;
    }
    const va = venues[a] ? 0 : 1;
    const vb = venues[b] ? 0 : 1;
    if (va !== vb) return va - vb;
    return a.localeCompare(b);
  });
}

export async function loadUniverse(force = false): Promise<UniverseResult> {
  if (!force) {
    const cached = getTtlCache<UniverseResult>(CACHE_KEY);
    if (cached) return cached;
  }

  const [btccResult, coverage, tickersAll] = await Promise.all([
    fetchBtccUsdtSymbols()
      .then((symbols) => ({ symbols, error: null as string | null }))
      .catch((error) => ({
        symbols: [] as UsdtSymbol[],
        error: error instanceof Error ? error.message : String(error),
      })),
    fetchAllVenueContracts(),
    fetchMergedTickers(),
  ]);

  const venues: Record<string, CandleVenue> = {};
  let selected: string[] = [];
  let skippedNoVenue = 0;
  let warning: string | null = null;
  let source = "coingecko-btcc ∩ (okx|bybit|binance usdt-m)";

  if (btccResult.symbols.length > 0) {
    source = "coingecko-btcc-all (ohlcv: okx|bybit|binance when available)";
    for (const row of btccResult.symbols) {
      selected.push(row.symbol);
      const venue = pickVenue(row.symbol, coverage);
      if (venue) {
        venues[row.symbol] = venue;
      } else {
        skippedNoVenue += 1;
      }
    }
    warning =
      skippedNoVenue > 0
        ? `BTCC掲載は全件表示します。うち ${skippedNoVenue} 件は公開USDT-M足が無く採点できません（価格のみ）。足がある銘柄は OKX → Bybit → Binance です。`
        : "対象はCoinGecko上のBTCC USDT銘柄です。足は OKX → Bybit → Binance の公開USDT-Mです。";
  } else {
    selected = Object.keys(coverage.okx);
    for (const symbol of selected) venues[symbol] = "okx";
    source = "okx-usdt-m-linear-swap-fallback";
    warning =
      "BTCC銘柄一覧の取得に失敗したため、OKXのUSDT-M先物一覧で代替しています。BTCC掲載ではありません。";
  }

  selected = sortUniverse(selected, venues);
  const contracts = mergeContracts(coverage, venues);
  const tickers: Record<string, TickerSnapshot> = {};
  for (const row of btccResult.symbols) {
    const snap = tickersAll[row.symbol];
    if (snap) {
      tickers[row.symbol] = snap;
    } else if (row.lastPrice != null) {
      tickers[row.symbol] = {
        last: row.lastPrice,
        change24hPct: null,
        high24h: null,
        low24h: null,
        volume24h: row.volume,
      };
    }
  }
  for (const symbol of selected) {
    if (!tickers[symbol] && tickersAll[symbol]) tickers[symbol] = tickersAll[symbol];
  }

  const result: UniverseResult = {
    symbols: selected,
    tickers,
    contracts,
    venues,
    btccCount: btccResult.symbols.length,
    skippedNoVenue,
    skippedNoOkx: skippedNoVenue,
    skippedSpotOrNonPerp: 0,
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
