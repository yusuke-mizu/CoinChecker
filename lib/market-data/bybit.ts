import { fetchJson, HttpError } from "@/lib/market-data/http";
import { toCompactUsdt, toDisplaySymbol } from "@/lib/market-data/provider";
import type { Candle, CoreTimeframe, PerpetualContract, TickerSnapshot } from "@/lib/types/market";

type BybitResponse<T> = {
  retCode: number;
  retMsg: string;
  result?: T;
};

const INTERVAL: Record<CoreTimeframe | "5m", string> = {
  "5m": "5",
  "15m": "15",
  "1h": "60",
  "4h": "240",
};

function num(v: string | undefined): number | null {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export async function fetchBybitUsdtMPerpetuals(): Promise<Record<string, PerpetualContract>> {
  const out: Record<string, PerpetualContract> = {};
  let cursor = "";
  for (let i = 0; i < 8; i += 1) {
    const qs = new URLSearchParams({
      category: "linear",
      limit: "1000",
      status: "Trading",
    });
    if (cursor) qs.set("cursor", cursor);
    const json = await fetchJson<
      BybitResponse<{
        nextPageCursor?: string;
        list?: Array<{
          symbol?: string;
          quoteCoin?: string;
          status?: string;
          contractType?: string;
          leverageFilter?: { maxLeverage?: string };
        }>;
      }>
    >(`https://api.bybit.com/v5/market/instruments-info?${qs.toString()}`, {
      timeoutMs: 20_000,
      retries: 2,
    });
    if (json.retCode !== 0) {
      throw new HttpError(`Bybit instruments failed: ${json.retMsg}`, undefined, "HTTP");
    }
    for (const row of json.result?.list ?? []) {
      const symbol = (row.symbol ?? "").toUpperCase();
      if (!symbol.endsWith("USDT")) continue;
      if ((row.quoteCoin ?? "").toUpperCase() !== "USDT") continue;
      if (row.contractType && row.contractType !== "LinearPerpetual") continue;
      const lever = num(row.leverageFilter?.maxLeverage);
      out[symbol] = {
        symbol,
        display: toDisplaySymbol(symbol),
        contractType: "USDT-M Perpetual",
        quoteAsset: "USDT",
        marginAsset: "USDT",
        settlement: "Perpetual",
        maxLeverage: lever,
        instId: symbol,
      };
    }
    cursor = json.result?.nextPageCursor ?? "";
    if (!cursor) break;
  }
  return out;
}

export async function fetchBybitOhlcv(
  symbol: string,
  timeframe: CoreTimeframe | "5m",
  limit = 250,
): Promise<Candle[]> {
  const compact = toCompactUsdt(symbol);
  const capped = Math.min(Math.max(limit, 1), 1000);
  const url = `https://api.bybit.com/v5/market/kline?category=linear&symbol=${encodeURIComponent(compact)}&interval=${INTERVAL[timeframe]}&limit=${capped}`;
  const json = await fetchJson<BybitResponse<{ list?: string[][] }>>(url, {
    timeoutMs: 12_000,
    retries: 2,
  });
  if (json.retCode !== 0) {
    throw new HttpError(`Bybit kline failed for ${compact}: ${json.retMsg}`, undefined, "HTTP");
  }
  const candles: Candle[] = (json.result?.list ?? [])
    .map((row) => {
      const openTime = Number(row[0]);
      return {
        openTime,
        open: Number(row[1]),
        high: Number(row[2]),
        low: Number(row[3]),
        close: Number(row[4]),
        volume: Number(row[5]),
        closeTime: openTime,
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
  return candles;
}

export async function fetchBybitTickers(): Promise<Record<string, TickerSnapshot>> {
  const json = await fetchJson<
    BybitResponse<{
      list?: Array<{
        symbol?: string;
        lastPrice?: string;
        price24hPcnt?: string;
        highPrice24h?: string;
        lowPrice24h?: string;
        volume24h?: string;
      }>;
    }>
  >("https://api.bybit.com/v5/market/tickers?category=linear", {
    timeoutMs: 20_000,
    retries: 2,
  });
  if (json.retCode !== 0) {
    throw new HttpError(`Bybit tickers failed: ${json.retMsg}`, undefined, "HTTP");
  }
  const out: Record<string, TickerSnapshot> = {};
  for (const row of json.result?.list ?? []) {
    const symbol = (row.symbol ?? "").toUpperCase();
    if (!symbol.endsWith("USDT")) continue;
    const last = num(row.lastPrice) ?? 0;
    const pct = num(row.price24hPcnt);
    out[symbol] = {
      last,
      change24hPct: pct == null ? null : pct * 100,
      high24h: num(row.highPrice24h),
      low24h: num(row.lowPrice24h),
      volume24h: num(row.volume24h),
    };
  }
  return out;
}

export async function fetchBybitOiHistory5m(symbol: string, limit = 100) {
  const compact = toCompactUsdt(symbol);
  const capped = Math.min(Math.max(limit, 5), 200);
  const url = `https://api.bybit.com/v5/market/open-interest?category=linear&symbol=${encodeURIComponent(compact)}&intervalTime=5min&limit=${capped}`;
  const json = await fetchJson<
    BybitResponse<{ list?: Array<{ timestamp?: string; openInterest?: string; openInterestValue?: string }> }>
  >(url, { timeoutMs: 12_000, retries: 1 });
  if (json.retCode !== 0) {
    throw new HttpError(`Bybit OI failed for ${compact}: ${json.retMsg}`, undefined, "HTTP");
  }
  return (json.result?.list ?? [])
    .map((row) => {
      const ts = Number(row.timestamp);
      const oi = Number(row.openInterest);
      const oiUsd = row.openInterestValue != null ? Number(row.openInterestValue) : null;
      return { ts, oi, oiUsd: Number.isFinite(oiUsd) ? oiUsd : null };
    })
    .filter((r) => Number.isFinite(r.ts) && Number.isFinite(r.oi))
    .sort((a, b) => a.ts - b.ts);
}

export async function fetchBybitFunding(symbol: string) {
  const compact = toCompactUsdt(symbol);
  const [cur, hist] = await Promise.allSettled([
    fetchJson<BybitResponse<{ list?: Array<{ fundingRate?: string; nextFundingTime?: string }> }>>(
      `https://api.bybit.com/v5/market/tickers?category=linear&symbol=${encodeURIComponent(compact)}`,
      { timeoutMs: 10_000, retries: 1 },
    ),
    fetchJson<BybitResponse<{ list?: Array<{ fundingRate?: string }> }>>(
      `https://api.bybit.com/v5/market/funding/history?category=linear&symbol=${encodeURIComponent(compact)}&limit=100`,
      { timeoutMs: 10_000, retries: 1 },
    ),
  ]);
  let rate: number | null = null;
  let nextFundingTime: number | null = null;
  if (cur.status === "fulfilled" && cur.value.retCode === 0) {
    const row = cur.value.result?.list?.[0];
    rate = num(row?.fundingRate);
    const nxt = Number(row?.nextFundingTime);
    nextFundingTime = Number.isFinite(nxt) ? nxt : null;
  }
  const history: number[] = [];
  if (hist.status === "fulfilled" && hist.value.retCode === 0) {
    for (const row of hist.value.result?.list ?? []) {
      const v = num(row.fundingRate);
      if (v != null) history.push(v);
    }
  }
  if (rate == null && history.length === 0) {
    throw new HttpError(`Bybit funding unavailable for ${compact}`, undefined, "HTTP");
  }
  return { rate, nextFundingTime, history };
}
