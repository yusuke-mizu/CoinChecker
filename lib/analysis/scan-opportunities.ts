import { loadUniverse } from "@/lib/analysis/universe";
import { CANDLE_LIMIT, evaluateOpportunity } from "@/lib/analysis/opportunity";
import { buildMarketContext, type MarketContext } from "@/lib/features/extract";
import { readActiveModel } from "@/lib/server/model-store";
import { loadBulkDerivatives, type BulkDerivativeStats } from "@/lib/market-data/bulk-derivatives";
import type { PredictionRecord, TrainedModel } from "@/lib/types/prediction";
import { fetchVenueOhlcv } from "@/lib/market-data/venue-router";
import { emaSeries } from "@/lib/indicators";
import { mapPool } from "@/lib/util/pool";
import { getTtlCache, setTtlCache } from "@/lib/util/ttl-cache";
import type { TickerSnapshot } from "@/lib/types/market";
import type {
  BtcRegime,
  ExcludedSymbol,
  OpportunityRow,
  OpportunityScanResult,
} from "@/lib/types/opportunity";
import type { CandleVenue } from "@/lib/types/venue";

/**
 * Symbols per request. One candle request each, so this bounds the Worker
 * budget. Lowered from 24 when the candle depth went to 900 bars, which roughly
 * tripled the payload each symbol brings back.
 */
export const MAX_BATCH = 16;
const CANDLE_CONCURRENCY = 6;
const REGIME_CACHE_KEY = "opportunity-btc-regime-v1";
const REGIME_CACHE_MS = 90_000;
const BTC_CONTEXT_CACHE_KEY = "opportunity-btc-features-v1";
const BTC_CONTEXT_CACHE_MS = 90_000;
const MODEL_CACHE_KEY = "opportunity-active-model-v1";
const MODEL_CACHE_MS = 300_000;

export type OpportunityCandidate = {
  symbol: string;
  display: string;
  venue: CandleVenue;
  turnoverUsd: number | null;
};

function turnoverOf(ticker: TickerSnapshot | null): number | null {
  if (!ticker) return null;
  if (ticker.quoteVolume24h != null && ticker.quoteVolume24h > 0) return ticker.quoteVolume24h;
  if (ticker.volume24h != null && ticker.volume24h > 0 && ticker.last > 0) {
    return ticker.volume24h * ticker.last;
  }
  return null;
}

/**
 * Every symbol with a usable public market, most liquid first. Nothing is
 * dropped here: symbols only fall out later if their candles cannot support an
 * estimate.
 */
export async function listOpportunityCandidates(): Promise<OpportunityCandidate[]> {
  const universe = await loadUniverse();
  return universe.candidates
    .filter((candidate) => candidate.marketVenue != null)
    .map((candidate) => ({
      symbol: candidate.symbol,
      display: candidate.display,
      venue: candidate.marketVenue as CandleVenue,
      turnoverUsd: turnoverOf(candidate.ticker),
    }))
    .sort(
      (a, b) => (b.turnoverUsd ?? 0) - (a.turnoverUsd ?? 0) || a.symbol.localeCompare(b.symbol),
    );
}

const NEUTRAL_REGIME: BtcRegime = {
  trend: "FLAT",
  atrPct: null,
  state: "NEUTRAL",
  label: "BTC Regime: 取得不可（中立扱い）",
};

export async function loadBtcRegime(venue: CandleVenue | null): Promise<BtcRegime> {
  const cached = getTtlCache<BtcRegime>(REGIME_CACHE_KEY);
  if (cached) return cached;
  if (!venue) return NEUTRAL_REGIME;
  try {
    const candles = await fetchVenueOhlcv(venue, "BTCUSDT", "15m", 120);
    if (candles.length < 60) return NEUTRAL_REGIME;
    const closes = candles.map((candle) => candle.close);
    const last = closes[closes.length - 1];
    const ema20 = emaSeries(closes, 20);
    const ema50 = emaSeries(closes, 50);
    const fast = ema20[ema20.length - 1];
    const slow = ema50[ema50.length - 1];
    let ranges = 0;
    for (let i = candles.length - 14; i < candles.length; i += 1) {
      ranges += Math.max(
        candles[i].high - candles[i].low,
        Math.abs(candles[i].high - candles[i - 1].close),
        Math.abs(candles[i].low - candles[i - 1].close),
      );
    }
    const atrPct = last > 0 ? (ranges / 14 / last) * 100 : null;
    const from = closes[Math.max(0, closes.length - 97)];
    const change24hPct = from > 0 ? ((last - from) / from) * 100 : 0;
    const trend: BtcRegime["trend"] =
      fast == null || slow == null ? "FLAT" : fast > slow ? "UP" : "DOWN";
    const state: BtcRegime["state"] =
      trend === "DOWN" && change24hPct <= -1.5
        ? "RISK_OFF"
        : trend === "UP" && change24hPct >= 1
          ? "RISK_ON"
          : "NEUTRAL";
    const regime: BtcRegime = {
      trend,
      atrPct,
      state,
      label: `BTC ${trend === "UP" ? "上昇" : trend === "DOWN" ? "下降" : "横ばい"} / 24h ${
        change24hPct >= 0 ? "+" : ""
      }${change24hPct.toFixed(2)}% / ATR ${atrPct == null ? "-" : `${atrPct.toFixed(2)}%`}`,
    };
    return setTtlCache(REGIME_CACHE_KEY, regime, REGIME_CACHE_MS);
  } catch {
    return NEUTRAL_REGIME;
  }
}

/**
 * BTC feature context for the model's market-regime columns.
 *
 * Fetched once per scan and cached, because every symbol in the universe reads
 * the same BTC bars. Aligning is by candle open time, so a symbol whose venue
 * timestamps differ simply falls back to the neutral regime encoding.
 */
async function loadBtcContext(venue: CandleVenue | null): Promise<MarketContext | null> {
  const cached = getTtlCache<MarketContext>(BTC_CONTEXT_CACHE_KEY);
  if (cached) return cached;
  if (!venue) return null;
  try {
    const candles = await fetchVenueOhlcv(venue, "BTCUSDT", "15m", CANDLE_LIMIT);
    if (candles.length < 300) return null;
    return setTtlCache(BTC_CONTEXT_CACHE_KEY, buildMarketContext(candles), BTC_CONTEXT_CACHE_MS);
  } catch {
    return null;
  }
}

/** Active model, cached in-process so a paginated scan reads KV once. */
async function loadModel(): Promise<TrainedModel | null> {
  const cached = getTtlCache<{ model: TrainedModel | null }>(MODEL_CACHE_KEY);
  if (cached) return cached.model;
  try {
    const model = await readActiveModel();
    return setTtlCache(MODEL_CACHE_KEY, { model }, MODEL_CACHE_MS).model;
  } catch {
    return null;
  }
}

export type ScanRequest = {
  offset?: number;
  limit?: number;
};

export type OpportunityBatch = OpportunityScanResult & {
  offset: number;
  total: number;
  /**
   * Predictions made in this batch. The client accumulates them across the whole
   * scan and posts once, so a paginated scan costs one KV write rather than one
   * per batch.
   */
  predictions: PredictionRecord[];
};

/**
 * Evaluates one slice of the universe. The client walks the slices so that no
 * single request has to hold hundreds of upstream fetches open.
 */
export async function scanOpportunities(request: ScanRequest = {}): Promise<OpportunityBatch> {
  const candidates = await listOpportunityCandidates();
  const offset = Math.max(0, Math.floor(request.offset ?? 0));
  const limit = Math.min(Math.max(Math.floor(request.limit ?? MAX_BATCH), 1), MAX_BATCH);
  const slice = candidates.slice(offset, offset + limit);

  const [derivatives, regime, universe, market, model] = await Promise.all([
    loadBulkDerivatives().catch(() => new Map<string, BulkDerivativeStats>()),
    loadBtcRegime(candidates[0]?.venue ?? null),
    loadUniverse(),
    loadBtcContext(candidates[0]?.venue ?? null),
    loadModel(),
  ]);

  const rows: OpportunityRow[] = [];
  const excluded: ExcludedSymbol[] = [];
  const predictions: PredictionRecord[] = [];

  await mapPool(slice, CANDLE_CONCURRENCY, async (candidate) => {
    try {
      const candles = await fetchVenueOhlcv(
        candidate.venue,
        candidate.symbol,
        "15m",
        CANDLE_LIMIT,
      );
      const outcome = evaluateOpportunity({
        symbol: candidate.symbol,
        display: candidate.display,
        venue: candidate.venue,
        candles,
        ticker: universe.tickers[candidate.symbol] ?? null,
        derivatives: derivatives.get(candidate.symbol) ?? null,
        regime,
        turnoverUsd: candidate.turnoverUsd,
        model,
        market,
      });
      if (outcome.ok) {
        rows.push(outcome.row);
        predictions.push(...outcome.predictions);
      } else {
        excluded.push({ symbol: candidate.symbol, reason: outcome.reason });
      }
    } catch (error) {
      excluded.push({
        symbol: candidate.symbol,
        reason: `15m足の取得に失敗: ${error instanceof Error ? error.message : String(error)}`,
      });
    }
  });

  return {
    rows,
    excluded,
    btcRegime: regime,
    requested: slice.length,
    evaluated: rows.length,
    offset,
    total: candidates.length,
    modelVersion: model?.version ?? null,
    predictions,
    updatedAt: new Date().toISOString(),
  };
}
