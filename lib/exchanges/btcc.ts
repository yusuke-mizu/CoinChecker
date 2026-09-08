import { fetchJson, HttpError } from "@/lib/market-data/http";
import { toDisplaySymbol } from "@/lib/market-data/provider";
import { getTtlCache, setTtlCache } from "@/lib/util/ttl-cache";
import type { SourceAttribution, UsdtSymbol } from "@/lib/types/market";
import type { SymbolProvider } from "@/lib/market-data/provider";

type CoinGeckoTicker = {
  base?: string;
  target?: string;
  last?: number;
  volume?: number;
  is_stale?: boolean;
  is_anomaly?: boolean;
  trade_url?: string | null;
};

type CoinGeckoTickersResponse = {
  tickers?: CoinGeckoTicker[];
};

export type DiscoveredBtccSymbol = {
  symbol: UsdtSymbol;
  evidence: SourceAttribution;
  warnings: string[];
};

const CACHE_KEY = "btcc-usdt-symbols-v2";
const CACHE_MS = 5 * 60_000;
let pending: Promise<DiscoveredBtccSymbol[]> | null = null;

/**
 * BTCC USDT symbol universe.
 *
 * Official BTCC TradeOpenAPI (Nov 2023 PDF) exposes GET /v1/config/symbollist
 * at https://api1.btloginc.com:9081, but it requires login token + signature.
 * Quote WebSocket wss://kapi1.btloginc.com:9082 also requires account login
 * before ReqKline. This app never calls trading endpoints.
 *
 * Public, unauthenticated listing used here:
 * CoinGecko Demo API GET /exchanges/btcc/tickers
 * Docs: https://docs.coingecko.com/reference/exchanges-id-tickers
 * Page size is 100. Use order=base_target for stable pagination.
 * Rate limit (Demo): typically ~5-30 calls/min; paginate with delay.
 *
 * TODO: BTCC unofficial WS docs (2018) expose public GetActiveContracts, but
 * examples are BTC_USD spot-style symbols, not current BTCC USDT products.
 * Do not scrape TradingView. Do not call BTCC order/position endpoints.
 */
async function loadBtccUsdtSymbols(): Promise<DiscoveredBtccSymbol[]> {
  const collected: DiscoveredBtccSymbol[] = [];
  const seen = new Set<string>();

  for (let page = 1; page <= 12; page += 1) {
    let tickers: CoinGeckoTicker[] = [];
    try {
      const data = await fetchJson<CoinGeckoTickersResponse>(
        `https://api.coingecko.com/api/v3/exchanges/btcc/tickers?page=${page}&order=base_target`,
        { timeoutMs: 8_000, retries: 1 },
      );
      tickers = data.tickers ?? [];
    } catch (error) {
      if (collected.length > 0) break;
      throw error;
    }
    if (tickers.length === 0) break;

    for (const ticker of tickers) {
      const base = (ticker.base ?? "").toUpperCase().trim();
      const target = (ticker.target ?? "").toUpperCase().trim();
      if (!base || target !== "USDT") continue;
      const symbol = `${base}USDT`;
      if (seen.has(symbol)) continue;
      seen.add(symbol);
      const warnings: string[] = [];
      if (ticker.is_stale) warnings.push("CoinGecko record is marked stale");
      if (ticker.is_anomaly) warnings.push("CoinGecko record is marked anomalous");
      collected.push({
        symbol: {
          symbol,
          base,
          quote: "USDT",
          display: toDisplaySymbol(symbol),
          sourceId: "coingecko:btcc",
          lastPrice: typeof ticker.last === "number" ? ticker.last : null,
          volume: typeof ticker.volume === "number" ? ticker.volume : null,
        },
        evidence: {
          provider: "coingecko",
          label: "CoinGecko BTCC ticker (third-party discovery)",
          observedAt: new Date().toISOString(),
          url: "https://api.coingecko.com/api/v3/exchanges/btcc/tickers",
          note: ticker.trade_url
            ? `Reported BTCC trade URL: ${ticker.trade_url}`
            : "This does not prove a BTCC perpetual contract.",
        },
        warnings,
      });
    }

    if (tickers.length < 100) break;
    if (page < 12) {
      await new Promise((resolve) => setTimeout(resolve, 1200));
    }
  }

  if (collected.length === 0) {
    throw new HttpError(
      "BTCC USDT symbols were empty from CoinGecko tickers",
      undefined,
      "HTTP",
    );
  }

  collected.sort((a, b) => a.symbol.symbol.localeCompare(b.symbol.symbol));
  return collected;
}

export async function discoverBtccUsdtSymbols(): Promise<DiscoveredBtccSymbol[]> {
  const cached = getTtlCache<DiscoveredBtccSymbol[]>(CACHE_KEY);
  if (cached) return cached;
  if (pending) return pending;

  pending = loadBtccUsdtSymbols()
    .then((symbols) => setTtlCache(CACHE_KEY, symbols, CACHE_MS))
    .finally(() => {
      pending = null;
    });
  return pending;
}

export async function fetchBtccUsdtSymbols(): Promise<UsdtSymbol[]> {
  return (await discoverBtccUsdtSymbols()).map((item) => item.symbol);
}

export const coinGeckoBtccSymbolProvider: SymbolProvider = {
  id: "coingecko-btcc-third-party",
  discoverSymbols: fetchBtccUsdtSymbols,
};
