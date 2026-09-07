import { fetchBtccUsdtSymbols } from "@/lib/exchanges/btcc";
import { okxSwapProvider } from "@/lib/market-data/okx-provider";
import { fetchVenueOhlcv, fetchVenueTicker, VENUE_LABEL } from "@/lib/market-data/venue-router";
import { toCompactUsdt, toDisplaySymbol } from "@/lib/market-data/provider";
import { HttpError } from "@/lib/market-data/http";
import { computeTimeframeIndicators } from "@/lib/scoring/indicators";
import { scoreDirection } from "@/lib/scoring/engine";
import { classifySignal } from "@/lib/scoring/signal";
import { scoreReversal } from "@/lib/scoring/reversal";
import { loadFuturesPositioning } from "@/lib/analysis/futures-data";
import { assessCandleQuality } from "@/lib/scoring/quality";
import { btcReturnCorrelation, HIGH_BTC_CORR } from "@/lib/correlation/pearson";
import type { CoreTimeframe, DataIssueCode } from "@/lib/types/market";
import type {
  SharedMarketContext,
  SymbolAnalysis,
  TimeframeIndicators,
} from "@/lib/types/scoring";

export { DATA_SOURCE_NOTES, DISCLAIMER } from "@/lib/analysis/notes";

const CORE: CoreTimeframe[] = ["4h", "1h", "15m"];
const CANDLE_LIMIT = 250;
function toIssue(error: unknown): DataIssueCode {
  if (error instanceof HttpError) {
    if (error.code === "RATE_LIMIT") return "RATE_LIMIT";
    if (error.code === "TIMEOUT") return "TIMEOUT";
    return "DATA_ERROR";
  }
  return "DATA_ERROR";
}

export async function loadBtccUsdtSymbols() {
  try {
    const symbols = await fetchBtccUsdtSymbols();
    return { symbols };
  } catch (error) {
    return {
      symbols: [],
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function baseAnalysis(
  symbol: string,
  extras: Partial<SymbolAnalysis> & Pick<SymbolAnalysis, "status" | "signal">,
): SymbolAnalysis {
  return {
    symbol,
    display: toDisplaySymbol(symbol),
    ticker: null,
    long: null,
    short: null,
    difference: null,
    bias: null,
    indicators: {},
    updatedAt: new Date().toISOString(),
    notes: [],
    dataSource: "okx-swap-public",
    btcCorrelation: null,
    rankLong: null,
    rankShort: null,
    reversal: null,
    futures: null,
    contract: {
      contractType: "USDT-M Perpetual",
      quoteAsset: "USDT",
      marginAsset: "USDT",
      settlement: "Perpetual",
      maxLeverage: null,
    },
    ...extras,
  };
}

export async function analyzeSymbol(
  symbol: string,
  context: SharedMarketContext = {
    btc4h: null,
    btc1hCloses: [],
    dominancePct: null,
  },
): Promise<SymbolAnalysis> {
  const compact = toCompactUsdt(symbol);
  const display = toDisplaySymbol(compact);
  const venue = context.venues?.[compact] ?? "okx";
  const notes: string[] = [`足・建玉: ${VENUE_LABEL[venue]}（BTCC公式足はログイン必須のため未使用）`];
  const indicators: Partial<Record<CoreTimeframe, TimeframeIndicators>> = {};
  let closes1h: number[] = [];

  let ticker = context.tickers?.[compact] ?? null;
  if (!ticker) {
    try {
      ticker = await fetchVenueTicker(venue, compact);
    } catch (error) {
      notes.push(`Ticker: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  const timeframeResults = await Promise.allSettled(
    CORE.map(async (timeframe) => {
      const candles = await fetchVenueOhlcv(venue, compact, timeframe, CANDLE_LIMIT);
      const quality = assessCandleQuality(candles, timeframe);
      return { timeframe, candles, quality };
    }),
  );

  for (let i = 0; i < CORE.length; i += 1) {
    const timeframe = CORE[i];
    const result = timeframeResults[i];
    if (result.status === "rejected") {
      notes.push(
        `${timeframe}: ${result.reason instanceof Error ? result.reason.message : String(result.reason)}`,
      );
      continue;
    }
    const { candles, quality } = result.value;
    if (!quality.ok) {
      notes.push(`${timeframe}: ${quality.reasons.join("; ")}`);
      continue;
    }
    indicators[timeframe] = computeTimeframeIndicators(timeframe, candles);
    if (timeframe === "1h") {
      closes1h = candles.map((c) => c.close);
    }
  }

  const tf4h = indicators["4h"] ?? null;
  const tf1h = indicators["1h"] ?? null;
  const tf15m = indicators["15m"] ?? null;

  if (!tf4h && !tf1h && !tf15m) {
    const failed = timeframeResults.find((item) => item.status === "rejected");
    const status =
      failed && failed.status === "rejected" ? toIssue(failed.reason) : "DATA_INSUFFICIENT";
    return baseAnalysis(compact, {
      display,
      status,
      ticker,
      signal: status === "DATA_INSUFFICIENT" ? "DATA INSUFFICIENT" : "DATA ERROR",
      notes,
      dataSource: `${venue}-usdt-m-public`,
    });
  }

  let btc4hForMarket = compact === "BTCUSDT" ? tf4h : context.btc4h;
  if (compact !== "BTCUSDT" && !btc4hForMarket) {
    try {
      const btcCandles = await okxSwapProvider.fetchOhlcv("BTCUSDT", "4h", CANDLE_LIMIT);
      const quality = assessCandleQuality(btcCandles, "4h");
      if (quality.ok) {
        btc4hForMarket = computeTimeframeIndicators("4h", btcCandles);
      } else {
        notes.push(`BTC 4H market context skipped: ${quality.reasons.join("; ")}`);
      }
    } catch (error) {
      notes.push(
        `BTC 4H market context failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  const market = {
    btc4h: btc4hForMarket,
    dominancePct: context.dominancePct,
    isBtc: compact === "BTCUSDT",
  };
  const futures = await loadFuturesPositioning(compact, tf4h, tf1h, tf15m, venue);
  if (!futures.availableOi) notes.push("OI unavailable");
  if (!futures.availableFunding) notes.push("Funding unavailable");
  const long = scoreDirection("long", { market, tf4h, tf1h, tf15m, futures });
  const short = scoreDirection("short", { market, tf4h, tf1h, tf15m, futures });
  const reversal = scoreReversal({
    tf4h,
    tf1h,
    tf15m,
    btc4h: btc4hForMarket,
    futures,
  });
  const classified = classifySignal(long, short, reversal);

  const btcCloses =
    compact === "BTCUSDT" ? closes1h : context.btc1hCloses;
  const btcCorrelation =
    compact === "BTCUSDT" ? 1 : btcReturnCorrelation(closes1h, btcCloses);
  if (btcCorrelation != null && Math.abs(btcCorrelation) >= HIGH_BTC_CORR && compact !== "BTCUSDT") {
    notes.push(`High BTC 1H return correlation (${btcCorrelation.toFixed(2)})`);
  }

  return {
    symbol: compact,
    display,
    status: "ok",
    ticker,
    long,
    short,
    difference: classified.difference,
    bias: classified.bias,
    signal: classified.signal,
    indicators,
    updatedAt: new Date().toISOString(),
    notes,
    dataSource: `${venue}-usdt-m-public`,
    btcCorrelation,
    rankLong: null,
    rankShort: null,
    reversal,
    futures,
    contract: {
      contractType: "USDT-M Perpetual",
      quoteAsset: "USDT",
      marginAsset: "USDT",
      settlement: "Perpetual",
      maxLeverage: null,
    },
  };
}
