import { fetchJson, HttpError } from "@/lib/market-data/http";
import { toCompactUsdt, toDisplaySymbol } from "@/lib/market-data/provider";
import type { Candle, CoreTimeframe, PerpetualContract, TickerSnapshot } from "@/lib/types/market";

type OkxResponse<T> = {
  code: string;
  msg: string;
  data: T;
};

type OkxCandle = [
  string,
  string,
  string,
  string,
  string,
  string,
  string,
  string,
  string,
];

type OkxTicker = {
  last?: string;
  open24h?: string;
  high24h?: string;
  low24h?: string;
  vol24h?: string;
};

const BAR: Record<CoreTimeframe | "5m", string> = {
  "5m": "5m",
  "15m": "15m",
  "1h": "1H",
  "4h": "4H",
};

export function toSwapInstId(symbol: string): string {
  const compact = toCompactUsdt(symbol);
  if (!compact.endsWith("USDT")) {
    throw new Error(`Not a USDT symbol: ${symbol}`);
  }
  const base = compact.slice(0, -4);
  return `${base}-USDT-SWAP`;
}

function parseNumber(value: string | undefined): number | null {
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/**
 * Public OKX market data. Used as OHLCV source because BTCC official kline
 * (ReqKline on wss://kapi1.btloginc.com:9082) requires authenticated login.
 *
 * Docs: https://www.okx.com/docs-v5/en/#order-book-trading-market-data-get-candlesticks
 * Rate limit: 20 requests / 2 seconds (IP).
 * Max 300 candles per request.
 */
export async function fetchOkxOhlcv(
  symbol: string,
  timeframe: CoreTimeframe | "5m",
  limit = 300,
): Promise<Candle[]> {
  const instId = toSwapInstId(symbol);
  const bar = BAR[timeframe];
  const capped = Math.min(Math.max(limit, 1), 300);
  const url = `https://www.okx.com/api/v5/market/candles?instId=${encodeURIComponent(instId)}&bar=${bar}&limit=${capped}`;
  const json = await fetchJson<OkxResponse<OkxCandle[]>>(url, {
    timeoutMs: 8_000,
    retries: 1,
  });

  if (json.code !== "0") {
    if (json.msg?.toLowerCase().includes("rate")) {
      throw new HttpError(json.msg, 429, "RATE_LIMIT");
    }
    throw new HttpError(
      `OKX candles failed for ${instId}: ${json.msg || json.code}`,
      undefined,
      "HTTP",
    );
  }

  const rows = json.data ?? [];
  const candles: Candle[] = rows
    .map((row) => {
      const openTime = Number(row[0]);
      const open = Number(row[1]);
      const high = Number(row[2]);
      const low = Number(row[3]);
      const close = Number(row[4]);
      const volume = Number(row[5]);
      return {
        openTime,
        open,
        high,
        low,
        close,
        volume,
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

function tickerFromRow(t: OkxTicker): TickerSnapshot {
  const last = parseNumber(t.last) ?? 0;
  const open24h = parseNumber(t.open24h);
  const change24hPct =
    open24h && open24h !== 0 ? ((last - open24h) / open24h) * 100 : null;
  return {
    last,
    change24hPct,
    high24h: parseNumber(t.high24h),
    low24h: parseNumber(t.low24h),
    volume24h: parseNumber(t.vol24h),
  };
}

export async function fetchOkxTicker(symbol: string): Promise<TickerSnapshot> {
  const instId = toSwapInstId(symbol);
  const url = `https://www.okx.com/api/v5/market/ticker?instId=${encodeURIComponent(instId)}`;
  const json = await fetchJson<OkxResponse<OkxTicker[]>>(url);
  if (json.code !== "0" || !json.data?.[0]) {
    throw new HttpError(`OKX ticker failed for ${instId}`, undefined, "HTTP");
  }
  return tickerFromRow(json.data[0]);
}

type OkxInstrument = {
  instId?: string;
  instType?: string;
  state?: string;
  settleCcy?: string;
  ctType?: string;
  lever?: string;
  uly?: string;
};

type OkxTickerRow = OkxTicker & {
  instId?: string;
};

export function compactFromOkxSwapInstId(instId: string): string | null {
  const suffix = "-USDT-SWAP";
  if (!instId.endsWith(suffix)) return null;
  return `${instId.slice(0, -suffix.length)}USDT`;
}

/** Live USDT-margined linear perpetual swaps (not spot, not coin-m, not delivery). */
export async function fetchOkxUsdtMPerpetuals(): Promise<Record<string, PerpetualContract>> {
  const url = "https://www.okx.com/api/v5/public/instruments?instType=SWAP";
  const json = await fetchJson<OkxResponse<OkxInstrument[]>>(url, {
    timeoutMs: 10_000,
    retries: 1,
  });
  if (json.code !== "0") {
    throw new HttpError(`OKX instruments failed: ${json.msg || json.code}`, undefined, "HTTP");
  }
  const out: Record<string, PerpetualContract> = {};
  for (const row of json.data ?? []) {
    if (row.state && row.state !== "live") continue;
    if ((row.settleCcy ?? "").toUpperCase() !== "USDT") continue;
    if (row.ctType && row.ctType !== "linear") continue;
    const compact = compactFromOkxSwapInstId(row.instId ?? "");
    if (!compact) continue;
    const lever = row.lever != null && row.lever !== "" ? Number(row.lever) : null;
    out[compact] = {
      symbol: compact,
      display: toDisplaySymbol(compact),
      contractType: "USDT-M Perpetual",
      quoteAsset: "USDT",
      marginAsset: "USDT",
      settlement: "Perpetual",
      maxLeverage: Number.isFinite(lever) ? lever : null,
      instId: row.instId ?? `${compact.slice(0, -4)}-USDT-SWAP`,
    };
  }
  return out;
}

export async function fetchOkxUsdtSwapSymbols(): Promise<Set<string>> {
  return new Set(Object.keys(await fetchOkxUsdtMPerpetuals()));
}

export async function fetchOkxOpenInterest(): Promise<Record<string, number>> {
  const url = "https://www.okx.com/api/v5/public/open-interest?instType=SWAP";
  const json = await fetchJson<OkxResponse<Array<{ instId?: string; oi?: string }>>>(url, {
    timeoutMs: 20_000,
    retries: 2,
  });
  if (json.code !== "0") {
    throw new HttpError(`OKX open interest failed: ${json.msg || json.code}`, undefined, "HTTP");
  }
  const out: Record<string, number> = {};
  for (const row of json.data ?? []) {
    const compact = compactFromOkxSwapInstId(row.instId ?? "");
    const oi = Number(row.oi);
    if (compact && Number.isFinite(oi)) out[compact] = oi;
  }
  return out;
}

type OiHistRow = {
  ts?: string;
  oi?: string;
  oiUsd?: string;
};

function parseOiHistoryPayload(data: unknown): Array<{ ts: number; oi: number; oiUsd: number | null }> {
  if (!Array.isArray(data)) return [];
  const out: Array<{ ts: number; oi: number; oiUsd: number | null }> = [];
  for (const row of data) {
    if (Array.isArray(row)) {
      const ts = Number(row[0]);
      const oi = Number(row[1]);
      const oiUsd = row[3] != null ? Number(row[3]) : null;
      if (Number.isFinite(ts) && Number.isFinite(oi)) {
        out.push({ ts, oi, oiUsd: Number.isFinite(oiUsd) ? oiUsd : null });
      }
      continue;
    }
    const rec = row as OiHistRow;
    const ts = Number(rec.ts);
    const oi = Number(rec.oi);
    const oiUsd = rec.oiUsd != null ? Number(rec.oiUsd) : null;
    if (Number.isFinite(ts) && Number.isFinite(oi)) {
      out.push({ ts, oi, oiUsd: Number.isFinite(oiUsd) ? oiUsd : null });
    }
  }
  return out.sort((a, b) => a.ts - b.ts);
}

/** Docs: GET /api/v5/rubik/stat/contracts/open-interest-history (5m/1H/1D). */
export async function fetchOkxOiHistory5m(symbol: string, limit = 100) {
  const instId = toSwapInstId(symbol);
  const capped = Math.min(Math.max(limit, 5), 100);
  const urls = [
    `https://www.okx.com/api/v5/rubik/stat/contracts/open-interest-history?instId=${encodeURIComponent(instId)}&period=5m&limit=${capped}`,
    `https://www.okx.com/api/v5/public/open-interest-history?instId=${encodeURIComponent(instId)}&period=5m&limit=${capped}`,
  ];
  let lastError: Error | null = null;
  for (const url of urls) {
    try {
      const json = await fetchJson<OkxResponse<unknown>>(url, { timeoutMs: 7_000, retries: 0 });
      if (json.code !== "0") {
        lastError = new HttpError(json.msg || json.code, undefined, "HTTP");
        continue;
      }
      const rows = parseOiHistoryPayload(json.data);
      if (rows.length) return rows;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
    }
  }
  if (lastError) throw lastError;
  return [];
}

export type OkxFundingSnapshot = {
  rate: number | null;
  nextFundingTime: number | null;
  history: number[];
};

export async function fetchOkxFunding(symbol: string): Promise<OkxFundingSnapshot> {
  const instId = toSwapInstId(symbol);
  const currentUrl = `https://www.okx.com/api/v5/public/funding-rate?instId=${encodeURIComponent(instId)}`;
  const histUrl = `https://www.okx.com/api/v5/public/funding-rate-history?instId=${encodeURIComponent(instId)}&limit=100`;
  const [curRes, histRes] = await Promise.allSettled([
    fetchJson<OkxResponse<Array<{ fundingRate?: string; nextFundingTime?: string }>>>(currentUrl, {
      timeoutMs: 7_000,
      retries: 0,
    }),
    fetchJson<OkxResponse<Array<{ fundingRate?: string }>>>(histUrl, {
      timeoutMs: 7_000,
      retries: 0,
    }),
  ]);
  let rate: number | null = null;
  let nextFundingTime: number | null = null;
  if (curRes.status === "fulfilled" && curRes.value.code === "0") {
    const row = curRes.value.data?.[0];
    rate = parseNumber(row?.fundingRate);
    const nxt = Number(row?.nextFundingTime);
    nextFundingTime = Number.isFinite(nxt) ? nxt : null;
  }
  const history: number[] = [];
  if (histRes.status === "fulfilled" && histRes.value.code === "0") {
    for (const row of histRes.value.data ?? []) {
      const v = parseNumber(row.fundingRate);
      if (v != null) history.push(v);
    }
  }
  if (rate == null && history.length === 0) {
    throw new HttpError(`Funding unavailable for ${instId}`, undefined, "HTTP");
  }
  return { rate, nextFundingTime, history };
}

/** All SWAP tickers in one request; keys are compact USDT symbols. */
export async function fetchOkxSwapTickers(): Promise<Record<string, TickerSnapshot>> {
  const url = "https://www.okx.com/api/v5/market/tickers?instType=SWAP";
  const json = await fetchJson<OkxResponse<OkxTickerRow[]>>(url, {
    timeoutMs: 10_000,
    retries: 1,
  });
  if (json.code !== "0") {
    throw new HttpError(`OKX tickers failed: ${json.msg || json.code}`, undefined, "HTTP");
  }
  const out: Record<string, TickerSnapshot> = {};
  for (const row of json.data ?? []) {
    const compact = compactFromOkxSwapInstId(row.instId ?? "");
    if (!compact) continue;
    out[compact] = tickerFromRow(row);
  }
  return out;
}
