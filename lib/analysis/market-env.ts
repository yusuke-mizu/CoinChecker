import { fetchBtcDominancePct } from "@/lib/market-data/coingecko-global";
import { fetchOkxOhlcv, fetchOkxTicker } from "@/lib/market-data/okx";
import { assessCandleQuality } from "@/lib/scoring/quality";
import { computeTimeframeIndicators } from "@/lib/scoring/indicators";
import { scoreDirection } from "@/lib/scoring/engine";
import { classifySignal } from "@/lib/scoring/signal";
import { scoreReversal } from "@/lib/scoring/reversal";
import { dataSourceDisplay } from "@/lib/data/provider-mode";
import { assessRegime } from "@/lib/scoring/regime";
import { scoreEntryTiming } from "@/lib/scoring/entry-timing";
import { decideSetup, nextEntryWindow } from "@/lib/scoring/setup";
import { loadFuturesPositioning } from "@/lib/analysis/futures-data";
import {
  assessAggregateDataQuality,
  confidenceFromDataQuality,
  emptyProvenance,
} from "@/lib/analysis/availability";
import { sourceForVenue } from "@/lib/market-data/venue-router";
import { getTtlCache, setTtlCache } from "@/lib/util/ttl-cache";
import type { FuturesPositioning, MarketEnvSnapshot, SymbolAnalysis, TimeframeIndicators } from "@/lib/types/scoring";

const CACHE_KEY = "market-env-v2";
const CACHE_MS = 60_000;

function btcAnalysis(
  ticker: SymbolAnalysis["ticker"],
  tf4h: TimeframeIndicators | null,
  tf1h: TimeframeIndicators | null,
  tf15m: TimeframeIndicators | null,
  dominancePct: number | null,
  notes: string[],
  futures: FuturesPositioning | null,
  timeframeQuality: SymbolAnalysis["timeframeQuality"],
): SymbolAnalysis {
  const validTimeframes = [
    ...(tf4h ? (["4h"] as const) : []),
    ...(tf1h ? (["1h"] as const) : []),
    ...(tf15m ? (["15m"] as const) : []),
  ];
  const canScore = validTimeframes.length >= 2;
  const dataQuality = assessAggregateDataQuality({
    validTimeframes,
    hasTicker: Boolean(ticker),
    hasOi: Boolean(futures?.availableOi),
    hasFunding: Boolean(futures?.availableFunding),
  });
  const sources = emptyProvenance();
  if (ticker) sources.ticker = sourceForVenue("okx", "ticker");
  if (validTimeframes.length) sources.ohlcv = sourceForVenue("okx", "ohlcv");
  if (futures?.availableOi) sources.oi = sourceForVenue("okx", "oi");
  if (futures?.availableFunding) sources.funding = sourceForVenue("okx", "funding");
  const market = { btc4h: tf4h, dominancePct, isBtc: true };
  const long =
    canScore ? scoreDirection("long", { market, tf4h, tf1h, tf15m, futures }) : null;
  const short =
    canScore ? scoreDirection("short", { market, tf4h, tf1h, tf15m, futures }) : null;
  const reversal = scoreReversal({ tf4h, tf1h, tf15m, btc4h: tf4h, futures });
  const classified =
    long && short
      ? classifySignal(long, short, reversal)
      : { difference: null, bias: null, signal: "DATA INSUFFICIENT" as const };
  const regime =
    tf4h || tf1h || tf15m ? assessRegime({ tf4h, tf1h, tf15m, futures }) : null;
  const src = dataSourceDisplay();
  const timing =
    long && short && regime
      ? scoreEntryTiming({
          tf4h,
          tf1h,
          tf15m,
          btc4h: tf4h,
          futures,
          regime,
          btcCorrelation: 1,
          side: (classified.difference ?? 0) >= 0 ? "long" : "short",
        })
      : null;
  const setup =
    long && short && regime && timing
      ? decideSetup({
          long,
          short,
          regime,
          timing,
          reversal,
          tf4hTrend: tf4h?.trend,
          tf1hTrend: tf1h?.trend,
          tf15mTrend: tf15m?.trend,
        })
      : null;
  return {
    symbol: "BTCUSDT",
    display: "BTC/USDT",
    availability: canScore ? "SCORING_AVAILABLE" : "MARKET_DATA_AVAILABLE",
    listingVerification: "DISCOVERED",
    contractClassification: "UNKNOWN",
    marketVenue: "okx",
    sources,
    dataQuality,
    timeframeQuality,
    rankingEligible: canScore,
    rankingExclusionReason: canScore ? null : "有効な時間足が2つ未満",
    status: long && short ? "ok" : "DATA_INSUFFICIENT",
    ticker,
    long,
    short,
    difference: classified.difference,
    bias: classified.bias,
    signal: classified.signal,
    indicators: {
      ...(tf4h ? { "4h": tf4h } : {}),
      ...(tf1h ? { "1h": tf1h } : {}),
      ...(tf15m ? { "15m": tf15m } : {}),
    },
    updatedAt: new Date().toISOString(),
    notes,
    dataSource: "okx-swap-public",
    btcCorrelation: 1,
    rankLong: null,
    rankShort: null,
    reversal,
    futures,
    regime,
    timing,
    setup,
    confidence: confidenceFromDataQuality(dataQuality),
    nextWindow: timing && regime ? nextEntryWindow(timing, regime) : null,
    dataSourceLabel: src.label,
    contract: {
      contractType: "USDT-M Perpetual",
      quoteAsset: "USDT",
      marginAsset: "USDT",
      settlement: "Perpetual",
      maxLeverage: null,
    },
  };
}

export async function loadMarketEnv(force = false): Promise<MarketEnvSnapshot> {
  if (!force) {
    const cached = getTtlCache<MarketEnvSnapshot>(CACHE_KEY);
    if (cached) return cached;
  }

  const notes: string[] = [];
  const [dominancePct, tickerResult, c4, c1, c15] = await Promise.all([
    fetchBtcDominancePct(),
    fetchOkxTicker("BTCUSDT")
      .then((ticker) => ({ ticker, error: null as string | null }))
      .catch((error) => ({
        ticker: null,
        error: error instanceof Error ? error.message : String(error),
      })),
    fetchOkxOhlcv("BTCUSDT", "4h", 250)
      .then((candles) => ({ candles, error: null as string | null }))
      .catch((error) => ({
        candles: [],
        error: error instanceof Error ? error.message : String(error),
      })),
    fetchOkxOhlcv("BTCUSDT", "1h", 250)
      .then((candles) => ({ candles, error: null as string | null }))
      .catch((error) => ({
        candles: [],
        error: error instanceof Error ? error.message : String(error),
      })),
    fetchOkxOhlcv("BTCUSDT", "15m", 250)
      .then((candles) => ({ candles, error: null as string | null }))
      .catch((error) => ({
        candles: [],
        error: error instanceof Error ? error.message : String(error),
      })),
  ]);

  if (tickerResult.error) notes.push(`BTC ticker: ${tickerResult.error}`);
  if (c4.error) notes.push(`BTC 4H: ${c4.error}`);
  if (c1.error) notes.push(`BTC 1H: ${c1.error}`);
  if (c15.error) notes.push(`BTC 15M: ${c15.error}`);

  const q4 = c4.candles.length ? assessCandleQuality(c4.candles, "4h") : null;
  const q1 = c1.candles.length ? assessCandleQuality(c1.candles, "1h") : null;
  const q15 = c15.candles.length ? assessCandleQuality(c15.candles, "15m") : null;
  const tf4h = q4?.ok ? computeTimeframeIndicators("4h", c4.candles) : null;
  const tf1h = q1?.ok ? computeTimeframeIndicators("1h", c1.candles) : null;
  const tf15m = q15?.ok ? computeTimeframeIndicators("15m", c15.candles) : null;
  if (q4 && !q4.ok) notes.push(`BTC 4H: ${q4.reasons.join("; ")}`);
  if (q1 && !q1.ok) notes.push(`BTC 1H: ${q1.reasons.join("; ")}`);
  if (q15 && !q15.ok) notes.push(`BTC 15M: ${q15.reasons.join("; ")}`);

  const dominanceNote =
    dominancePct == null
      ? "CoinGecko /global did not return BTC dominance."
      : "Spot BTC dominance from CoinGecko /global (level only, not a history series).";

  const futures = await loadFuturesPositioning("BTCUSDT", tf4h, tf1h, tf15m);
  if (!futures.availableOi) notes.push("OI unavailable");
  if (!futures.availableFunding) notes.push("Funding unavailable");

  const snapshot: MarketEnvSnapshot = {
    btc: btcAnalysis(
      tickerResult.ticker,
      tf4h,
      tf1h,
      tf15m,
      dominancePct,
      notes,
      futures,
      {
        ...(q4 ? { "4h": q4 } : {}),
        ...(q1 ? { "1h": q1 } : {}),
        ...(q15 ? { "15m": q15 } : {}),
      },
    ),
    btc4h: tf4h,
    btc1hCloses: c1.candles.map((c) => c.close),
    dominancePct,
    dominanceNote,
    dataSourceLabel: dataSourceDisplay().label,
    dataSourceTest: dataSourceDisplay().testMode,
    updatedAt: new Date().toISOString(),
    notes,
  };
  return setTtlCache(CACHE_KEY, snapshot, CACHE_MS);
}
