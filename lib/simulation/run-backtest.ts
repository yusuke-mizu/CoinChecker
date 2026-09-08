import { MAX_TRADES_PER_STREAM, runSymbolBacktest } from "./backtest";
import {
  HOLDING_HISTOGRAM_EDGES,
  RETURN_HISTOGRAM_EDGES,
  buildScoreCard,
  groupBreakdown,
  histogram,
  simulatePortfolio,
} from "./metrics";
import { buildPopulation } from "./monte-carlo";
import { WARMUP_BARS } from "./series";
import { fetchAllVenueContracts, fetchVenueOhlcv } from "@/lib/market-data/venue-router";
import { mapPool } from "@/lib/util/pool";
import { getTtlCache, setTtlCache } from "@/lib/util/ttl-cache";
import type { Candle, PerpetualContract } from "@/lib/types/market";
import type { CandleVenue } from "@/lib/types/venue";
import type {
  BacktestResult,
  BacktestWarning,
  SimTrade,
  SimTimeframe,
  SimulationSettings,
  StrategyReport,
} from "@/lib/types/simulation";

export const MAX_BACKTEST_SYMBOLS = 8;
/** Individual trades sent to the client. Aggregates always cover the full set. */
const TRADE_TRANSPORT_LIMIT = 1500;
const COVERAGE_CACHE_KEY = "backtest-venue-coverage-v1";
const COVERAGE_CACHE_MS = 10 * 60_000;
const FETCH_CONCURRENCY = 3;

/** Deepest single-request history each venue allows, so we prefer the richest one. */
const VENUE_CANDLE_LIMIT: Record<CandleVenue, number> = {
  binance: 1500,
  bybit: 1000,
  okx: 300,
};
const VENUE_PREFERENCE: CandleVenue[] = ["binance", "bybit", "okx"];

type Coverage = Record<CandleVenue, Record<string, PerpetualContract>>;

async function loadCoverage(): Promise<Coverage> {
  const cached = getTtlCache<Coverage>(COVERAGE_CACHE_KEY);
  if (cached) return cached;
  const coverage = await fetchAllVenueContracts();
  return setTtlCache(COVERAGE_CACHE_KEY, coverage, COVERAGE_CACHE_MS);
}

function pickBacktestVenue(symbol: string, coverage: Coverage): CandleVenue | null {
  return VENUE_PREFERENCE.find((venue) => coverage[venue][symbol]) ?? null;
}

export async function runBacktest(settings: SimulationSettings): Promise<BacktestResult> {
  const warnings: BacktestWarning[] = [];
  const symbols = settings.symbols.slice(0, MAX_BACKTEST_SYMBOLS);
  if (settings.symbols.length > symbols.length) {
    warnings.push({
      scope: "settings",
      message: `1回のBacktestは${MAX_BACKTEST_SYMBOLS}銘柄までに制限しています。`,
    });
  }

  const coverage = await loadCoverage();
  const jobs: Array<{ symbol: string; timeframe: SimTimeframe; venue: CandleVenue }> = [];
  for (const symbol of symbols) {
    const venue = pickBacktestVenue(symbol, coverage);
    if (!venue) {
      warnings.push({ scope: symbol, message: "公開USDT-M市場が見つかりませんでした。" });
      continue;
    }
    for (const timeframe of settings.timeframes) {
      jobs.push({ symbol, timeframe, venue });
    }
  }

  let candlesLoaded = 0;
  let requests = 0;
  let dataStart: number | null = null;
  let dataEnd: number | null = null;
  const trades: SimTrade[] = [];

  await mapPool(jobs, FETCH_CONCURRENCY, async (job) => {
    let candles: Candle[] = [];
    try {
      requests += 1;
      candles = await fetchVenueOhlcv(
        job.venue,
        job.symbol,
        job.timeframe,
        VENUE_CANDLE_LIMIT[job.venue],
      );
    } catch (error) {
      warnings.push({
        scope: `${job.symbol} ${job.timeframe}`,
        message: `OHLCV取得に失敗: ${error instanceof Error ? error.message : String(error)}`,
      });
      return;
    }
    if (candles.length < WARMUP_BARS + 5) {
      warnings.push({
        scope: `${job.symbol} ${job.timeframe}`,
        message: `指標ウォームアップに必要な${WARMUP_BARS}本に届かず（${candles.length}本）除外しました。`,
      });
      return;
    }
    candlesLoaded += candles.length;
    const first = candles[0].openTime;
    const last = candles[candles.length - 1].openTime;
    dataStart = dataStart == null ? first : Math.min(dataStart, first);
    dataEnd = dataEnd == null ? last : Math.max(dataEnd, last);

    const produced = runSymbolBacktest({
      symbol: job.symbol,
      timeframe: job.timeframe,
      candles,
      settings,
    });
    trades.push(...produced);
    for (const strategy of settings.strategies) {
      if (produced.filter((trade) => trade.strategy === strategy).length >= MAX_TRADES_PER_STREAM) {
        warnings.push({
          scope: `${job.symbol} ${job.timeframe} ${strategy}`,
          message: `Trade数が上限${MAX_TRADES_PER_STREAM}に達したため打ち切りました。`,
        });
      }
    }
  });

  trades.sort((a, b) => a.entryTime - b.entryTime);

  const byStrategy: StrategyReport[] = settings.strategies
    .map((strategy) => {
      const rows = trades.filter((trade) => trade.strategy === strategy);
      return {
        strategy,
        scorecard: buildScoreCard(rows),
        regimes: groupBreakdown(rows, (trade) => trade.regime),
      };
    })
    .filter((report) => report.scorecard.tradeCount > 0);

  if (trades.length === 0) {
    warnings.push({
      scope: "result",
      message:
        "条件に合致するTradeが発生しませんでした。NO TRADEも正常な結果です。条件やHolding Timeを見直してください。",
    });
  }

  return {
    settings,
    dataStart,
    dataEnd,
    candlesLoaded,
    requests,
    trades: trades.slice(-TRADE_TRANSPORT_LIMIT),
    totalTrades: trades.length,
    population: buildPopulation(trades),
    scorecard: buildScoreCard(trades),
    portfolio: simulatePortfolio(trades, settings),
    byStrategy,
    bySymbol: groupBreakdown(trades, (trade) => trade.symbol),
    byTimeframe: groupBreakdown(trades, (trade) => trade.timeframe),
    byRegime: groupBreakdown(trades, (trade) => trade.regime),
    byVolatility: groupBreakdown(trades, (trade) => trade.volatility),
    byHoldingBucket: groupBreakdown(trades, (trade) => `${trade.holdingBars} bars`),
    returnHistogram: histogram(
      trades.map((trade) => trade.netNotionalReturnPct),
      RETURN_HISTOGRAM_EDGES,
      "%",
    ),
    holdingHistogram: histogram(
      trades.map((trade) => trade.holdingMinutes),
      HOLDING_HISTOGRAM_EDGES,
      "m",
    ),
    warnings,
    generatedAt: new Date().toISOString(),
  };
}
