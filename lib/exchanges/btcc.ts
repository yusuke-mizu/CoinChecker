import { fetchJson, HttpError } from "@/lib/market-data/http";
import { toDisplaySymbol } from "@/lib/market-data/provider";
import type { UsdtSymbol } from "@/lib/types/market";

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
export async function fetchBtccUsdtSymbols(): Promise<UsdtSymbol[]> {
  const collected: UsdtSymbol[] = [];
  const seen = new Set<string>();

  for (let page = 1; page <= 12; page += 1) {
    let tickers: CoinGeckoTicker[] = [];
    try {
      const data = await fetchJson<CoinGeckoTickersResponse>(
        `https://api.coingecko.com/api/v3/exchanges/btcc/tickers?page=${page}&order=base_target`,
        { timeoutMs: 15_000, retries: 2 },
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
      collected.push({
        symbol,
        base,
        quote: "USDT",
        display: toDisplaySymbol(symbol),
        sourceId: "coingecko:btcc",
        lastPrice: typeof ticker.last === "number" ? ticker.last : null,
        volume: typeof ticker.volume === "number" ? ticker.volume : null,
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

  collected.sort((a, b) => a.symbol.localeCompare(b.symbol));
  return collected;
}
