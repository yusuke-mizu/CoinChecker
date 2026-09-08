import "server-only";
import { fetchJson, HttpError } from "@/lib/market-data/http";
import { getServerSecret } from "@/lib/server/env";

type Options = {
  timeoutMs?: number;
  retries?: number;
};

export async function fetchCoinGeckoJson<T>(
  path: string,
  options: Options = {},
): Promise<T> {
  const proKey = getServerSecret("COINGECKO_PRO_API_KEY");
  const demoKey =
    getServerSecret("COINGECKO_DEMO_API_KEY") ??
    getServerSecret("COINGECKO_API_KEY");
  const key = proKey ?? demoKey;
  const baseUrl = proKey
    ? "https://pro-api.coingecko.com/api/v3"
    : "https://api.coingecko.com/api/v3";
  const headers: Record<string, string> | undefined = proKey
    ? { "x-cg-pro-api-key": proKey }
    : demoKey
      ? { "x-cg-demo-api-key": demoKey }
      : undefined;

  try {
    return await fetchJson<T>(`${baseUrl}${path}`, {
      ...options,
      headers,
    });
  } catch (error) {
    if (
      !key &&
      error instanceof HttpError &&
      (error.status === 401 || error.status === 403 || error.status === 429)
    ) {
      throw new HttpError(
        `CoinGecko keyless request was rejected (HTTP ${error.status}). ` +
          "Set the COINGECKO_DEMO_API_KEY Worker secret.",
        error.status,
        error.status === 429 ? "RATE_LIMIT" : "HTTP",
      );
    }
    throw error;
  }
}
