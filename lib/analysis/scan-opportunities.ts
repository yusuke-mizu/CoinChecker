import { loadUniverse } from "@/lib/analysis/universe";
import { CANDLE_LIMIT, evaluateOpportunity } from "@/lib/analysis/opportunity";
import { loadBulkDerivatives, type BulkDerivativeStats } from "@/lib/market-data/bulk-derivatives";
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

/** Symbols per request. One candle request each, so this bounds the Worker budget. */
export const MAX_BATCH = 24;
const CANDLE_CONCURRENCY = 6;
const REGIME_CACHE_KEY = "opportunity-btc-regime-v1";
const REGIME_CACHE_MS = 90_000;

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

export type ScanRequest = {
  offset?: number;
  limit?: number;
};

export type OpportunityBatch = OpportunityScanResult & {
  offset: number;
  total: number;
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

  const [derivatives, regime, universe] = await Promise.all([
    loadBulkDerivatives().catch(() => new Map<string, BulkDerivativeStats>()),
    loadBtcRegime(candidates[0]?.venue ?? null),
    loadUniverse(),
  ]);

  const rows: OpportunityRow[] = [];
  const excluded: ExcludedSymbol[] = [];

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
      });
      if (outcome.ok) rows.push(outcome.row);
      else excluded.push({ symbol: candidate.symbol, reason: outcome.reason });
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
    updatedAt: new Date().toISOString(),
  };
}
