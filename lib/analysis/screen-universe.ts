import { loadUniverse } from "@/lib/analysis/universe";
import { fetchVenueOhlcv } from "@/lib/market-data/venue-router";
import { rsiWilder } from "@/lib/indicators";
import { mapPool } from "@/lib/util/pool";
import { getTtlCache, setTtlCache } from "@/lib/util/ttl-cache";
import type { Candle, TickerSnapshot } from "@/lib/types/market";
import type {
  LightScreenRow,
  ScreenResult,
  TurnoverBasis,
} from "@/lib/types/screening";
import type { CandleVenue } from "@/lib/types/venue";

const CACHE_KEY = "screen-universe-v1";
const CACHE_MS = 60_000;

/** Ticker-only shortlist size. Costs no extra upstream requests. */
export const PRESCREEN_MAX = 100;
/** Symbols that additionally get one 15m candle request. Bounded for the Worker budget. */
export const CANDLE_PROBE_MAX = 40;
/** Concurrent candle requests. Kept low so venue rate limits are not exhausted. */
const CANDLE_CONCURRENCY = 4;
const CANDLE_LIMIT = 96;
const MIN_PROBE_CANDLES = 32;

export type ScreenOptions = {
  prescreenSize?: number;
  candleProbeSize?: number;
  detailSize?: number;
  force?: boolean;
};

function clamp(value: number, min = 0, max = 100): number {
  return Math.min(max, Math.max(min, value));
}

function mean(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length);
}

/** Rank of `value` inside `sorted` expressed as 0-100. */
function percentile(sorted: number[], value: number): number {
  if (sorted.length <= 1) return 50;
  let low = 0;
  let high = sorted.length;
  while (low < high) {
    const mid = (low + high) >> 1;
    if (sorted[mid] < value) low = mid + 1;
    else high = mid;
  }
  return (low / (sorted.length - 1)) * 100;
}

function turnoverOf(ticker: TickerSnapshot | null): {
  turnoverUsd: number | null;
  basis: TurnoverBasis;
} {
  if (!ticker) return { turnoverUsd: null, basis: "UNKNOWN" };
  if (ticker.quoteVolume24h != null && ticker.quoteVolume24h > 0) {
    return { turnoverUsd: ticker.quoteVolume24h, basis: "QUOTE" };
  }
  if (ticker.volume24h != null && ticker.volume24h > 0 && ticker.last > 0) {
    return { turnoverUsd: ticker.volume24h * ticker.last, basis: "ESTIMATED" };
  }
  return { turnoverUsd: null, basis: "UNKNOWN" };
}

function pricePosition(ticker: TickerSnapshot | null): number | null {
  if (!ticker || ticker.high24h == null || ticker.low24h == null) return null;
  const span = ticker.high24h - ticker.low24h;
  if (!(span > 0)) return null;
  return clamp(((ticker.last - ticker.low24h) / span) * 100);
}

function rangePct(ticker: TickerSnapshot | null): number | null {
  if (!ticker || ticker.high24h == null || ticker.low24h == null || !(ticker.last > 0)) return null;
  return ((ticker.high24h - ticker.low24h) / ticker.last) * 100;
}

function atrPercent(candles: Candle[], period = 14): number | null {
  if (candles.length < period + 1) return null;
  const ranges: number[] = [];
  for (let i = candles.length - period; i < candles.length; i += 1) {
    const previous = candles[i - 1].close;
    ranges.push(
      Math.max(
        candles[i].high - candles[i].low,
        Math.abs(candles[i].high - previous),
        Math.abs(candles[i].low - previous),
      ),
    );
  }
  const last = candles[candles.length - 1].close;
  if (!(last > 0)) return null;
  return (mean(ranges) / last) * 100;
}

function returnPct(candles: Candle[], barsBack: number): number | null {
  if (candles.length <= barsBack) return null;
  const from = candles[candles.length - 1 - barsBack].close;
  const to = candles[candles.length - 1].close;
  if (!(from > 0)) return null;
  return ((to - from) / from) * 100;
}

/**
 * Screening-grade quality gate. Deliberately weaker than assessCandleQuality,
 * which requires 210 candles for EMA200 and is meant for full analysis.
 */
function probeUsable(candles: Candle[], now: number): boolean {
  if (candles.length < MIN_PROBE_CANDLES) return false;
  const last = candles[candles.length - 1];
  if (now - last.openTime > 15 * 60_000 * 4) return false;
  return candles.every(
    (candle) =>
      candle.high >= candle.low &&
      candle.open > 0 &&
      candle.close > 0 &&
      Number.isFinite(candle.volume) &&
      candle.volume >= 0,
  );
}

/**
 * Neutral opportunity score. Liquidity and tradable range dominate; extended or
 * exhausted price locations are penalized so that pure momentum does not rank first.
 */
function scoreRow(row: {
  liquidityScore: number;
  activityScore: number;
  pricePosition24h: number | null;
  rsi15m: number | null;
  abnormalMove: boolean;
  return1hPct: number | null;
  atrPct: number | null;
}): { setupScore: number; screenScore: number } {
  let setup = 60;
  if (row.pricePosition24h != null) {
    // Mid-range locations leave room in both directions; 24h extremes do not.
    const distanceFromEdge = 50 - Math.abs(row.pricePosition24h - 50);
    setup += (distanceFromEdge / 50) * 25 - 10;
  }
  if (row.rsi15m != null) {
    if (row.rsi15m >= 80 || row.rsi15m <= 20) setup -= 20;
    else if (row.rsi15m >= 70 || row.rsi15m <= 30) setup -= 8;
    else setup += 8;
  }
  if (row.abnormalMove) setup -= 25;
  if (row.return1hPct != null && row.atrPct != null && row.atrPct > 0) {
    const extension = Math.abs(row.return1hPct) / row.atrPct;
    if (extension >= 3) setup -= 15;
    else if (extension <= 1.2) setup += 6;
  }
  const setupScore = Math.round(clamp(setup));
  const screenScore = Math.round(
    clamp(row.liquidityScore * 0.4 + row.activityScore * 0.25 + setupScore * 0.35),
  );
  return { setupScore, screenScore };
}

/**
 * Phase 1. Ranks every discovered BTCC candidate from bulk ticker data that the
 * universe already loaded, then spends at most `candleProbeSize` extra requests
 * refining the shortlist with short-term candle metrics.
 */
export async function screenUniverse(options: ScreenOptions = {}): Promise<ScreenResult> {
  const prescreenSize = Math.min(Math.max(options.prescreenSize ?? PRESCREEN_MAX, 10), PRESCREEN_MAX);
  const probeSize = Math.min(Math.max(options.candleProbeSize ?? 24, 0), CANDLE_PROBE_MAX);
  const detailSize = Math.min(Math.max(options.detailSize ?? 25, 1), 30);

  const cacheKey = `${CACHE_KEY}:${prescreenSize}:${probeSize}:${detailSize}`;
  if (!options.force) {
    const cached = getTtlCache<ScreenResult>(cacheKey);
    if (cached) return cached;
  }

  const universe = await loadUniverse();
  const now = Date.now();
  const tradable = universe.candidates.filter((candidate) => candidate.marketVenue != null);

  const base = tradable.map((candidate) => {
    const ticker = candidate.ticker;
    const { turnoverUsd, basis } = turnoverOf(ticker);
    const notes: string[] = [];
    if (basis === "ESTIMATED") notes.push("Turnoverはbase volume×priceの概算です");
    if (basis === "UNKNOWN") notes.push("24h Turnover取得不可のためConfidenceを低下");
    return {
      candidate,
      ticker,
      turnoverUsd,
      basis,
      change24hPct: ticker?.change24hPct ?? null,
      pricePosition24h: pricePosition(ticker),
      range24hPct: rangePct(ticker),
      notes,
    };
  });

  const turnovers = base
    .map((row) => row.turnoverUsd)
    .filter((value): value is number => value != null && value > 0)
    .map((value) => Math.log10(value))
    .sort((a, b) => a - b);
  const ranges = base
    .map((row) => row.range24hPct)
    .filter((value): value is number => value != null)
    .sort((a, b) => a - b);

  const prescreened = base
    .map((row) => {
      const liquidityScore =
        row.turnoverUsd != null && row.turnoverUsd > 0
          ? percentile(turnovers, Math.log10(row.turnoverUsd))
          : 0;
      const activityScore = row.range24hPct != null ? percentile(ranges, row.range24hPct) : 40;
      const abnormalMove = Math.abs(row.change24hPct ?? 0) >= 25;
      const scored = scoreRow({
        liquidityScore,
        activityScore,
        pricePosition24h: row.pricePosition24h,
        rsi15m: null,
        abnormalMove,
        return1hPct: null,
        atrPct: null,
      });
      const confidencePenalty =
        (row.basis === "QUOTE" ? 0 : row.basis === "ESTIMATED" ? 10 : 25) +
        (row.pricePosition24h == null ? 10 : 0);
      const screenRow: LightScreenRow = {
        symbol: row.candidate.symbol,
        display: row.candidate.display,
        venue: row.candidate.marketVenue,
        stage: "TICKER_ONLY",
        last: row.ticker?.last ?? null,
        turnoverUsd: row.turnoverUsd,
        turnoverBasis: row.basis,
        change24hPct: row.change24hPct,
        pricePosition24h: row.pricePosition24h,
        range24hPct: row.range24hPct,
        return1hPct: null,
        return15mPct: null,
        rsi15m: null,
        atrPct: null,
        volumeRatio: null,
        abnormalMove,
        liquidityScore: Math.round(liquidityScore),
        activityScore: Math.round(activityScore),
        setupScore: scored.setupScore,
        screenScore: scored.screenScore,
        confidencePenalty,
        excluded: row.ticker == null,
        notes: row.notes,
      };
      return screenRow;
    })
    .sort(
      (a, b) =>
        Number(a.excluded) - Number(b.excluded) ||
        b.screenScore - a.screenScore ||
        b.liquidityScore - a.liquidityScore ||
        a.symbol.localeCompare(b.symbol),
    )
    .slice(0, prescreenSize);

  const probeTargets = prescreened
    .filter((row) => !row.excluded && row.venue != null)
    .slice(0, probeSize);

  let candleRequests = 0;
  await mapPool(probeTargets, CANDLE_CONCURRENCY, async (row) => {
    try {
      candleRequests += 1;
      const candles = await fetchVenueOhlcv(
        row.venue as CandleVenue,
        row.symbol,
        "15m",
        CANDLE_LIMIT,
      );
      if (!probeUsable(candles, now)) {
        row.notes.push("15m足が不足または鮮度不足のためTickerのみで評価");
        row.confidencePenalty += 15;
        return;
      }
      const closes = candles.map((candle) => candle.close);
      const volumes = candles.map((candle) => candle.volume);
      const recentVolume = volumes[volumes.length - 1];
      const baseVolume = mean(volumes.slice(-21, -1));
      row.stage = "CANDLE_PROBED";
      row.return15mPct = returnPct(candles, 1);
      row.return1hPct = returnPct(candles, 4);
      row.rsi15m = rsiWilder(closes);
      row.atrPct = atrPercent(candles);
      row.volumeRatio = baseVolume > 0 ? recentVolume / baseVolume : null;
      row.abnormalMove =
        row.abnormalMove ||
        (row.atrPct != null &&
          row.atrPct > 0 &&
          Math.abs(row.return1hPct ?? 0) / row.atrPct >= 4);
      const scored = scoreRow({
        liquidityScore: row.liquidityScore,
        activityScore: row.activityScore,
        pricePosition24h: row.pricePosition24h,
        rsi15m: row.rsi15m,
        abnormalMove: row.abnormalMove,
        return1hPct: row.return1hPct,
        atrPct: row.atrPct,
      });
      row.setupScore = scored.setupScore;
      row.screenScore = scored.screenScore;
    } catch (error) {
      row.notes.push(
        `15m足の取得に失敗: ${error instanceof Error ? error.message : String(error)}`,
      );
      row.confidencePenalty += 20;
    }
  });

  const rows = [...prescreened].sort(
    (a, b) =>
      Number(a.excluded) - Number(b.excluded) ||
      Number(b.stage === "CANDLE_PROBED") - Number(a.stage === "CANDLE_PROBED") ||
      b.screenScore - a.screenScore ||
      b.liquidityScore - a.liquidityScore ||
      a.symbol.localeCompare(b.symbol),
  );

  const result: ScreenResult = {
    discovered: universe.candidates.length,
    marketDataAvailable: tradable.length,
    prescreened: prescreened.length,
    candleProbed: rows.filter((row) => row.stage === "CANDLE_PROBED").length,
    rows,
    detailCandidates: rows
      .filter((row) => !row.excluded && row.venue != null)
      .slice(0, detailSize)
      .map((row) => row.symbol),
    candleRequests,
    warning:
      tradable.length === 0
        ? "同名の公開USDT-M市場が見つからず、軽量スクリーニングを実行できませんでした。"
        : null,
    updatedAt: new Date().toISOString(),
  };

  return setTtlCache(cacheKey, result, CACHE_MS);
}
