import { listedWithoutPublicPerp, DECISION_EMPTY } from "@/lib/analysis/listed-only";
import { fetchBtccUsdtSymbols } from "@/lib/exchanges/btcc";
import {
  fetchVenueOhlcv,
  fetchVenueTicker,
  sourceForVenue,
  VENUE_LABEL,
} from "@/lib/market-data/venue-router";
import {
  assessAggregateDataQuality,
  confidenceFromDataQuality,
  emptyProvenance,
} from "@/lib/analysis/availability";
import { toCompactUsdt, toDisplaySymbol } from "@/lib/market-data/provider";
import { HttpError } from "@/lib/market-data/http";
import { computeTimeframeIndicators } from "@/lib/scoring/indicators";
import { scoreDirection } from "@/lib/scoring/engine";
import { classifySignal } from "@/lib/scoring/signal";
import { scoreReversal } from "@/lib/scoring/reversal";
import { assessRegime } from "@/lib/scoring/regime";
import { scoreEntryTiming } from "@/lib/scoring/entry-timing";
import { scoreExpectedEntry } from "@/lib/scoring/expected-entry";
import { buildTradePlan } from "@/lib/scoring/trade-plan";
import { analyzeReach } from "@/lib/scoring/reach-probability";
import { decideSetup, nextEntryWindow } from "@/lib/scoring/setup";
import { dataSourceDisplay } from "@/lib/data/provider-mode";
import { loadFuturesPositioning } from "@/lib/analysis/futures-data";
import { assessCandleQuality } from "@/lib/scoring/quality";
import { btcReturnBeta, btcReturnCorrelation, HIGH_BTC_CORR } from "@/lib/correlation/pearson";
import type {
  BtccCandidate,
  Candle,
  CoreTimeframe,
  DataIssueCode,
  FeedProvenance,
} from "@/lib/types/market";
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
  metadata: {
    candidate?: BtccCandidate;
    venue: import("@/lib/types/venue").CandleVenue | null;
    sources: FeedProvenance;
    dataQuality: SymbolAnalysis["dataQuality"];
    timeframeQuality: SymbolAnalysis["timeframeQuality"];
  },
  extras: Partial<SymbolAnalysis> & Pick<SymbolAnalysis, "status" | "signal">,
): SymbolAnalysis {
  const scoringAvailable = Boolean(extras.long && extras.short);
  return {
    symbol,
    display: toDisplaySymbol(symbol),
    availability: scoringAvailable
      ? "SCORING_AVAILABLE"
      : metadata.venue
        ? "MARKET_DATA_AVAILABLE"
        : "DISCOVERED",
    listingVerification: metadata.candidate?.listingVerification ?? "DISCOVERED",
    contractClassification: metadata.candidate?.contract ?? "UNKNOWN",
    marketVenue: metadata.venue,
    sources: metadata.sources,
    dataQuality: metadata.dataQuality,
    timeframeQuality: metadata.timeframeQuality,
    rankingEligible: scoringAvailable,
    rankingExclusionReason: scoringAvailable
      ? null
      : "有効な時間足が2つ未満のためランキング対象外",
    ticker: null,
    long: null,
    short: null,
    entryExpectancy: { long: null, short: null },
    tradePlans: { long: null, short: null },
    reach: { long: null, short: null },
    difference: null,
    bias: null,
    indicators: {},
    updatedAt: new Date().toISOString(),
    notes: [],
    dataSource: "okx-swap-public",
    btcCorrelation: null,
    btcBeta: null,
    rankLong: null,
    rankShort: null,
    reversal: null,
    futures: null,
    ...DECISION_EMPTY,
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
  const candidate = context.candidates?.[compact];
  const venue = context.venues ? (context.venues[compact] ?? null) : "okx";
  if (!venue) {
    return listedWithoutPublicPerp(compact, context.tickers?.[compact] ?? null, candidate);
  }
  const notes: string[] = [`足・建玉: ${VENUE_LABEL[venue]}（BTCC公式足はログイン必須のため未使用）`];
  const indicators: Partial<Record<CoreTimeframe, TimeframeIndicators>> = {};
  const candlesByTimeframe: Partial<Record<CoreTimeframe, Candle[]>> = {};
  const timeframeQuality: SymbolAnalysis["timeframeQuality"] = {};
  let closes1h: number[] = [];
  const sources: FeedProvenance = candidate
    ? {
        ...candidate.sources,
        listing: [...candidate.sources.listing],
      }
    : emptyProvenance();

  let ticker = context.tickers?.[compact] ?? null;
  if (!ticker) {
    try {
      ticker = await fetchVenueTicker(venue, compact);
      sources.ticker = sourceForVenue(venue, "ticker");
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
      timeframeQuality[timeframe] = {
        ok: false,
        code: toIssue(result.reason),
        reasons: [result.reason instanceof Error ? result.reason.message : String(result.reason)],
        candleCount: 0,
        lastOpenTime: null,
      };
      notes.push(
        `${timeframe}: ${result.reason instanceof Error ? result.reason.message : String(result.reason)}`,
      );
      continue;
    }
    const { candles, quality } = result.value;
    timeframeQuality[timeframe] = quality;
    sources.ohlcv = sourceForVenue(venue, "ohlcv");
    if (!quality.ok) {
      notes.push(`${timeframe}: ${quality.reasons.join("; ")}`);
      continue;
    }
    indicators[timeframe] = computeTimeframeIndicators(timeframe, candles);
    candlesByTimeframe[timeframe] = candles;
    if (timeframe === "1h") {
      closes1h = candles.map((c) => c.close);
    }
  }

  const tf4h = indicators["4h"] ?? null;
  const tf1h = indicators["1h"] ?? null;
  const tf15m = indicators["15m"] ?? null;

  const validTimeframes = CORE.filter((timeframe) => Boolean(indicators[timeframe]));
  const futures = await loadFuturesPositioning(compact, tf4h, tf1h, tf15m, venue);
  if (futures.availableOi) sources.oi = sourceForVenue(venue, "oi");
  if (futures.availableFunding) sources.funding = sourceForVenue(venue, "funding");
  const dataQuality = assessAggregateDataQuality({
    validTimeframes,
    hasTicker: Boolean(ticker),
    hasOi: futures.availableOi,
    hasFunding: futures.availableFunding,
  });

  if (validTimeframes.length < 2) {
    const failed = timeframeResults.find((item) => item.status === "rejected");
    const status =
      failed && failed.status === "rejected" ? toIssue(failed.reason) : "DATA_INSUFFICIENT";
    return baseAnalysis(
      compact,
      { candidate, venue, sources, dataQuality, timeframeQuality },
      {
        display,
        status,
        ticker,
        signal: status === "DATA_INSUFFICIENT" ? "DATA INSUFFICIENT" : "DATA ERROR",
        notes: [...notes, "有効な4H・1H・15Mが2つ未満のためスコアを算出しません。"],
        dataSource: `${venue}-usdt-m-public`,
        futures,
        confidence: confidenceFromDataQuality(dataQuality),
      },
    );
  }

  let btc4hForMarket = compact === "BTCUSDT" ? tf4h : context.btc4h;
  if (compact !== "BTCUSDT" && !btc4hForMarket) {
    try {
      const btcCandles = await fetchVenueOhlcv("okx", "BTCUSDT", "4h", CANDLE_LIMIT);
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
  if (!futures.availableOi) notes.push("OI unavailable");
  if (!futures.availableFunding) notes.push("Funding unavailable");
  const regime = assessRegime({ tf4h, tf1h, tf15m, futures });
  const long = scoreDirection("long", { market, tf4h, tf1h, tf15m, futures });
  const short = scoreDirection("short", { market, tf4h, tf1h, tf15m, futures });
  const reversal = scoreReversal({
    tf4h,
    tf1h,
    tf15m,
    btc4h: btc4hForMarket,
    futures,
  });
  const btcCloses =
    compact === "BTCUSDT" ? closes1h : context.btc1hCloses;
  const btcCorrelation =
    compact === "BTCUSDT" ? 1 : btcReturnCorrelation(closes1h, btcCloses);
  const btcBeta = compact === "BTCUSDT" ? 1 : btcReturnBeta(closes1h, btcCloses);
  if (btcCorrelation != null && Math.abs(btcCorrelation) >= HIGH_BTC_CORR && compact !== "BTCUSDT") {
    notes.push(`High BTC 1H return correlation (${btcCorrelation.toFixed(2)})`);
  }

  const directionalDifference = long.total - short.total;
  const side = directionalDifference >= 0 ? "long" : "short";
  const timing = scoreEntryTiming({
    tf4h,
    tf1h,
    tf15m,
    btc4h: btc4hForMarket,
    futures,
    regime,
    btcCorrelation,
    side,
  });
  const expectedLong = scoreExpectedEntry({
    direction: "LONG",
    candles: candlesByTimeframe,
    indicators,
    timing,
    reversal,
    futures,
    regime,
    btc4h: btc4hForMarket,
    btcCorrelation,
    dominancePct: context.dominancePct,
    currentPrice: ticker?.last,
  });
  const expectedShort = scoreExpectedEntry({
    direction: "SHORT",
    candles: candlesByTimeframe,
    indicators,
    timing,
    reversal,
    futures,
    regime,
    btc4h: btc4hForMarket,
    btcCorrelation,
    dominancePct: context.dominancePct,
    currentPrice: ticker?.last,
  });
  const rankedLong = { ...long, total: expectedLong?.total ?? 0 };
  const rankedShort = { ...short, total: expectedShort?.total ?? 0 };
  const classified = classifySignal(rankedLong, rankedShort, reversal);
  const setup = decideSetup({
    long: rankedLong,
    short: rankedShort,
    regime,
    timing,
    reversal,
    tf4hTrend: tf4h?.trend,
    tf1hTrend: tf1h?.trend,
    tf15mTrend: tf15m?.trend,
  });
  const nextWindow = nextEntryWindow(timing, regime);
  const src = dataSourceDisplay();
  const confidence = confidenceFromDataQuality(dataQuality);
  const tradePlans = {
    long: expectedLong
      ? buildTradePlan({
          assessment: expectedLong,
          candles: candlesByTimeframe,
          indicators,
          futures,
          dataQuality: dataQuality.score,
          confidence,
          hardStopPct: context.hardStopPct,
        })
      : null,
    short: expectedShort
      ? buildTradePlan({
          assessment: expectedShort,
          candles: candlesByTimeframe,
          indicators,
          futures,
          dataQuality: dataQuality.score,
          confidence,
          hardStopPct: context.hardStopPct,
        })
      : null,
  };
  const reachInput = {
    candles: candlesByTimeframe,
    indicators,
    futures,
    dataQuality: dataQuality.score,
    hardStopPct: context.hardStopPct,
  };
  const reach = {
    long: expectedLong
      ? analyzeReach({ direction: "LONG" as const, assessment: expectedLong, ...reachInput })
      : null,
    short: expectedShort
      ? analyzeReach({ direction: "SHORT" as const, assessment: expectedShort, ...reachInput })
      : null,
  };

  return {
    symbol: compact,
    display,
    availability: "SCORING_AVAILABLE",
    listingVerification: candidate?.listingVerification ?? "DISCOVERED",
    contractClassification: candidate?.contract ?? "UNKNOWN",
    marketVenue: venue,
    sources,
    dataQuality,
    timeframeQuality,
    rankingEligible: true,
    rankingExclusionReason: null,
    status: "ok",
    ticker,
    long,
    short,
    entryExpectancy: { long: expectedLong, short: expectedShort },
    tradePlans,
    reach,
    difference: classified.difference,
    bias: classified.bias,
    signal: classified.signal,
    indicators,
    updatedAt: new Date().toISOString(),
    notes,
    dataSource: `${venue}-usdt-m-public`,
    btcCorrelation,
    btcBeta,
    rankLong: null,
    rankShort: null,
    reversal,
    futures,
    regime,
    timing,
    setup,
    confidence,
    nextWindow,
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
