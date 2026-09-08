import { fetchJson, HttpError } from "@/lib/market-data/http";
import { toCompactUsdt, toDisplaySymbol } from "@/lib/market-data/provider";
import type { Candle, CoreTimeframe, PerpetualContract, TickerSnapshot } from "@/lib/types/market";

const INTERVAL: Record<CoreTimeframe | "5m", string> = {
  "5m": "5m",
  "15m": "15m",
  "1h": "1h",
  "4h": "4h",
};

function num(v: string | undefined): number | null {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export async function fetchBinanceUsdtMPerpetuals(): Promise<Record<string, PerpetualContract>> {
  const json = await fetchJson<{
    symbols?: Array<{
      symbol?: string;
      status?: string;
      contractType?: string;
      quoteAsset?: string;
    }>;
  }>("https://fapi.binance.com/fapi/v1/exchangeInfo", {
    timeoutMs: 10_000,
    retries: 1,
  });
  const out: Record<string, PerpetualContract> = {};
  for (const row of json.symbols ?? []) {
    const symbol = (row.symbol ?? "").toUpperCase();
    if (row.status !== "TRADING") continue;
    if (row.contractType !== "PERPETUAL") continue;
    if ((row.quoteAsset ?? "").toUpperCase() !== "USDT") continue;
    if (!symbol.endsWith("USDT")) continue;
    out[symbol] = {
      symbol,
      display: toDisplaySymbol(symbol),
      contractType: "USDT-M Perpetual",
      quoteAsset: "USDT",
      marginAsset: "USDT",
      settlement: "Perpetual",
      maxLeverage: null,
      instId: symbol,
    };
  }
  return out;
}

export async function fetchBinanceOhlcv(
  symbol: string,
  timeframe: CoreTimeframe | "5m",
  limit = 250,
): Promise<Candle[]> {
  const compact = toCompactUsdt(symbol);
  const capped = Math.min(Math.max(limit, 1), 1500);
  const url = `https://fapi.binance.com/fapi/v1/klines?symbol=${encodeURIComponent(compact)}&interval=${INTERVAL[timeframe]}&limit=${capped}`;
  const rows = await fetchJson<Array<Array<string | number>>>(url, {
    timeoutMs: 8_000,
    retries: 1,
  });
  if (!Array.isArray(rows)) {
    throw new HttpError(`Binance kline failed for ${compact}`, undefined, "HTTP");
  }
  return rows
    .map((row) => {
      const openTime = Number(row[0]);
      return {
        openTime,
        open: Number(row[1]),
        high: Number(row[2]),
        low: Number(row[3]),
        close: Number(row[4]),
        volume: Number(row[5]),
        closeTime: Number(row[6]),
      };
    })
    .filter(
      (c) =>
        Number.isFinite(c.openTime) &&
        Number.isFinite(c.open) &&
        Number.isFinite(c.high) &&
        Number.isFinite(c.low) &&
        Number.isFinite(c.close) &&
        Number.isFinite(c.volume),
    )
    .sort((a, b) => a.openTime - b.openTime);
}

export async function fetchBinanceTickers(): Promise<Record<string, TickerSnapshot>> {
  const rows = await fetchJson<
    Array<{
      symbol?: string;
      lastPrice?: string;
      priceChangePercent?: string;
      highPrice?: string;
      lowPrice?: string;
      volume?: string;
      quoteVolume?: string;
    }>
  >("https://fapi.binance.com/fapi/v1/ticker/24hr", { timeoutMs: 10_000, retries: 1 });
  const out: Record<string, TickerSnapshot> = {};
  for (const row of rows) {
    const symbol = (row.symbol ?? "").toUpperCase();
    if (!symbol.endsWith("USDT")) continue;
    out[symbol] = {
      last: num(row.lastPrice) ?? 0,
      change24hPct: num(row.priceChangePercent),
      high24h: num(row.highPrice),
      low24h: num(row.lowPrice),
      volume24h: num(row.volume),
      quoteVolume24h: num(row.quoteVolume),
    };
  }
  return out;
}

export async function fetchBinanceOiHistory5m(symbol: string, limit = 100) {
  const compact = toCompactUsdt(symbol);
  const capped = Math.min(Math.max(limit, 5), 500);
  const url = `https://fapi.binance.com/futures/data/openInterestHist?symbol=${encodeURIComponent(compact)}&period=5m&limit=${capped}`;
  const rows = await fetchJson<Array<{ timestamp?: number; sumOpenInterest?: string; sumOpenInterestValue?: string }>>(
    url,
    { timeoutMs: 7_000, retries: 0 },
  );
  if (!Array.isArray(rows)) {
    throw new HttpError(`Binance OI failed for ${compact}`, undefined, "HTTP");
  }
  return rows
    .map((row) => {
      const ts = Number(row.timestamp);
      const oi = Number(row.sumOpenInterest);
      const oiUsd = row.sumOpenInterestValue != null ? Number(row.sumOpenInterestValue) : null;
      return { ts, oi, oiUsd: Number.isFinite(oiUsd) ? oiUsd : null };
    })
    .filter((r) => Number.isFinite(r.ts) && Number.isFinite(r.oi))
    .sort((a, b) => a.ts - b.ts);
}

export async function fetchBinanceFunding(symbol: string) {
  const compact = toCompactUsdt(symbol);
  const [prem, hist] = await Promise.allSettled([
    fetchJson<{ lastFundingRate?: string; nextFundingTime?: number }>(
      `https://fapi.binance.com/fapi/v1/premiumIndex?symbol=${encodeURIComponent(compact)}`,
      { timeoutMs: 7_000, retries: 0 },
    ),
    fetchJson<Array<{ fundingRate?: string }>>(
      `https://fapi.binance.com/fapi/v1/fundingRate?symbol=${encodeURIComponent(compact)}&limit=100`,
      { timeoutMs: 7_000, retries: 0 },
    ),
  ]);
  let rate: number | null = null;
  let nextFundingTime: number | null = null;
  if (prem.status === "fulfilled") {
    const raw = prem.value as { lastFundingRate?: string; nextFundingTime?: number } | Array<{ lastFundingRate?: string; nextFundingTime?: number }>;
    const row = Array.isArray(raw) ? raw[0] : raw;
    rate = num(row?.lastFundingRate);
    const nxt = Number(row?.nextFundingTime);
    nextFundingTime = Number.isFinite(nxt) ? nxt : null;
  }
  const history: number[] = [];
  if (hist.status === "fulfilled" && Array.isArray(hist.value)) {
    for (const row of hist.value) {
      const v = num(row.fundingRate);
      if (v != null) history.push(v);
    }
  }
  if (rate == null && history.length === 0) {
    throw new HttpError(`Binance funding unavailable for ${compact}`, undefined, "HTTP");
  }
  return { rate, nextFundingTime, history };
}
