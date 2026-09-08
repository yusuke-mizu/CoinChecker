import { fetchCoinGeckoJson } from "@/lib/market-data/coingecko";

type GlobalResponse = {
  data?: {
    market_cap_percentage?: {
      btc?: number;
    };
  };
};

/** CoinGecko public /global. Returns current BTC dominance only (no history). */
export async function fetchBtcDominancePct(): Promise<number | null> {
  try {
    const json = await fetchCoinGeckoJson<GlobalResponse>(
      "/global",
      { timeoutMs: 12_000, retries: 1 },
    );
    const value = json.data?.market_cap_percentage?.btc;
    return typeof value === "number" && Number.isFinite(value) ? value : null;
  } catch {
    return null;
  }
}
