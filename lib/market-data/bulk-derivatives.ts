import { fetchJson } from "@/lib/market-data/http";
import { getTtlCache, setTtlCache } from "@/lib/util/ttl-cache";

/**
 * Funding and open interest for the whole universe in two requests.
 *
 * The per-symbol funding/OI endpoints cost one request each, which does not
 * scale to a few hundred symbols. Binance premiumIndex and Bybit tickers both
 * return every contract at once, so the board can use these signals without
 * adding per-symbol cost.
 */

export type BulkDerivativeStats = {
  fundingRate: number | null;
  fundingSource: "binance" | "bybit" | null;
  openInterestUsd: number | null;
  openInterestSource: "bybit" | null;
};

const CACHE_KEY = "bulk-derivatives-v1";
const CACHE_MS = 90_000;

function num(value: string | number | undefined | null): number | null {
  if (value == null || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

async function binanceFunding(): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  const rows = await fetchJson<
    Array<{ symbol?: string; lastFundingRate?: string }>
  >("https://fapi.binance.com/fapi/v1/premiumIndex", { timeoutMs: 10_000, retries: 1 });
  if (!Array.isArray(rows)) return out;
  for (const row of rows) {
    const symbol = (row.symbol ?? "").toUpperCase();
    const rate = num(row.lastFundingRate);
    if (symbol.endsWith("USDT") && rate != null) out.set(symbol, rate);
  }
  return out;
}

async function bybitDerivatives(): Promise<
  Map<string, { fundingRate: number | null; openInterestUsd: number | null }>
> {
  const out = new Map<string, { fundingRate: number | null; openInterestUsd: number | null }>();
  const json = await fetchJson<{
    retCode?: number;
    result?: {
      list?: Array<{
        symbol?: string;
        fundingRate?: string;
        openInterestValue?: string;
      }>;
    };
  }>("https://api.bybit.com/v5/market/tickers?category=linear", {
    timeoutMs: 10_000,
    retries: 1,
  });
  if (json.retCode !== 0) return out;
  for (const row of json.result?.list ?? []) {
    const symbol = (row.symbol ?? "").toUpperCase();
    if (!symbol.endsWith("USDT")) continue;
    out.set(symbol, {
      fundingRate: num(row.fundingRate),
      openInterestUsd: num(row.openInterestValue),
    });
  }
  return out;
}

export async function loadBulkDerivatives(): Promise<Map<string, BulkDerivativeStats>> {
  const cached = getTtlCache<Map<string, BulkDerivativeStats>>(CACHE_KEY);
  if (cached) return cached;

  const [binance, bybit] = await Promise.allSettled([binanceFunding(), bybitDerivatives()]);
  const binanceMap = binance.status === "fulfilled" ? binance.value : new Map<string, number>();
  const bybitMap =
    bybit.status === "fulfilled"
      ? bybit.value
      : new Map<string, { fundingRate: number | null; openInterestUsd: number | null }>();

  const merged = new Map<string, BulkDerivativeStats>();
  for (const symbol of new Set([...binanceMap.keys(), ...bybitMap.keys()])) {
    const binanceRate = binanceMap.get(symbol) ?? null;
    const bybitRow = bybitMap.get(symbol);
    merged.set(symbol, {
      fundingRate: binanceRate ?? bybitRow?.fundingRate ?? null,
      fundingSource:
        binanceRate != null ? "binance" : bybitRow?.fundingRate != null ? "bybit" : null,
      openInterestUsd: bybitRow?.openInterestUsd ?? null,
      openInterestSource: bybitRow?.openInterestUsd != null ? "bybit" : null,
    });
  }
  return setTtlCache(CACHE_KEY, merged, CACHE_MS);
}
