import { fetchJson, HttpError } from "@/lib/market-data/http";
import { toCompactUsdt } from "@/lib/market-data/provider";
import type { Candle, CoreTimeframe, TickerSnapshot } from "@/lib/types/market";

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

function toSwapInstId(symbol: string): string {
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
    timeoutMs: 12_000,
    retries: 2,
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
  state?: string;
};

type OkxTickerRow = OkxTicker & {
  instId?: string;
};

export function compactFromOkxSwapInstId(instId: string): string | null {
  const suffix = "-USDT-SWAP";
  if (!instId.endsWith(suffix)) return null;
  return `${instId.slice(0, -suffix.length)}USDT`;
}

/** Live USDT perpetual swap names on OKX, as compact BTCUSDT keys. */
export async function fetchOkxUsdtSwapSymbols(): Promise<Set<string>> {
  const url = "https://www.okx.com/api/v5/public/instruments?instType=SWAP";
  const json = await fetchJson<OkxResponse<OkxInstrument[]>>(url, {
    timeoutMs: 20_000,
    retries: 2,
  });
  if (json.code !== "0") {
    throw new HttpError(`OKX instruments failed: ${json.msg || json.code}`, undefined, "HTTP");
  }
  const out = new Set<string>();
  for (const row of json.data ?? []) {
    if (row.state && row.state !== "live") continue;
    const compact = compactFromOkxSwapInstId(row.instId ?? "");
    if (compact) out.add(compact);
  }
  return out;
}

/** All SWAP tickers in one request; keys are compact USDT symbols. */
export async function fetchOkxSwapTickers(): Promise<Record<string, TickerSnapshot>> {
  const url = "https://www.okx.com/api/v5/market/tickers?instType=SWAP";
  const json = await fetchJson<OkxResponse<OkxTickerRow[]>>(url, {
    timeoutMs: 20_000,
    retries: 2,
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
