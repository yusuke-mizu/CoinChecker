import { writeBarrierFeatures } from "@/lib/features/barrier";
import {
  BARRIER_FEATURE_COUNT,
  extractStateFeatures,
  FEATURE_COUNT,
  STATE_FEATURE_COUNT,
  type MarketContext,
  type SymbolContext,
} from "@/lib/features/extract";
import { FEATURE_WARMUP_BARS } from "@/lib/features/feature-series";
import type { PredictionDirection, TouchOutcome } from "@/lib/types/prediction";

/** Target distances in percent, shared by the dataset and the live grid. */
export const TARGET_GRID = [0.5, 1.0, 1.5, 2.0, 3.0, 5.0, 10.0];
export const STOP_GRID = [0.5, 0.7, 1.0, 1.5, 2.0];
/** Horizons in 15m bars: 15m, 30m, 1h, 2h, 4h. */
export const HORIZON_BARS = [1, 2, 4, 8, 16];
export const BAR_MINUTES = 15;
export const MAX_HORIZON_BARS = Math.max(...HORIZON_BARS);

export type LabelledRow = {
  /** Entry bar open time. Rows are sorted by this for chronological splitting. */
  time: number;
  symbol: string;
  features: Float64Array;
  targetFirst: 0 | 1;
  stopFirst: 0 | 1;
  priorTarget: number;
  priorStop: number;
  ambiguous: boolean;
};

export type Dataset = {
  rows: LabelledRow[];
  ambiguousCount: number;
  skippedBars: number;
};

/**
 * Resolves which barrier was reached first.
 *
 * Same-bar collisions are unresolvable from OHLC alone: a candle whose high
 * reached the target and whose low reached the stop gives no ordering. The rule
 * here is fixed and pessimistic — such a bar counts as STOP, never TARGET — and
 * the row is flagged so the ambiguity rate stays visible instead of silently
 * inflating win rates.
 */
export function resolveFirstTouch(
  highs: number[],
  lows: number[],
  entryIndex: number,
  entryPrice: number,
  direction: PredictionDirection,
  targetPct: number,
  stopPct: number,
  bars: number,
): { outcome: TouchOutcome; ambiguous: boolean; barsToOutcome: number } {
  const long = direction === "LONG";
  const targetLevel = long
    ? entryPrice * (1 + targetPct / 100)
    : entryPrice * (1 - targetPct / 100);
  const stopLevel = long ? entryPrice * (1 - stopPct / 100) : entryPrice * (1 + stopPct / 100);

  for (let j = 1; j <= bars; j += 1) {
    const index = entryIndex + j;
    const high = highs[index];
    const low = lows[index];
    const hitTarget = long ? high >= targetLevel : low <= targetLevel;
    const hitStop = long ? low <= stopLevel : high >= stopLevel;
    if (hitTarget && hitStop) return { outcome: "STOP", ambiguous: true, barsToOutcome: j };
    if (hitStop) return { outcome: "STOP", ambiguous: false, barsToOutcome: j };
    if (hitTarget) return { outcome: "TARGET", ambiguous: false, barsToOutcome: j };
  }
  return { outcome: "NEITHER", ambiguous: false, barsToOutcome: bars };
}

/** Maximum favourable / adverse excursion over a window, in percent. */
export function excursions(
  highs: number[],
  lows: number[],
  entryIndex: number,
  entryPrice: number,
  direction: PredictionDirection,
  bars: number,
): { mfePct: number; maePct: number } {
  const long = direction === "LONG";
  let best = 0;
  let worst = 0;
  for (let j = 1; j <= bars; j += 1) {
    const index = entryIndex + j;
    if (index >= highs.length) break;
    const up = ((highs[index] - entryPrice) / entryPrice) * 100;
    const down = ((lows[index] - entryPrice) / entryPrice) * 100;
    const favourable = long ? up : -down;
    const adverse = long ? -down : up;
    if (favourable > best) best = favourable;
    if (adverse > worst) worst = adverse;
  }
  return { mfePct: best, maePct: worst };
}

/**
 * Deterministic combination picker.
 *
 * Enumerating all 175 (target, stop, horizon) combinations per bar would blow up
 * the row count and produce heavily duplicated rows. Rotating through the grid
 * by bar index gives even coverage, keeps runs reproducible without an RNG, and
 * avoids the correlation of taking every combination at the same timestamp.
 */
function comboAt(index: number): { targetPct: number; stopPct: number; bars: number } {
  const total = TARGET_GRID.length * STOP_GRID.length * HORIZON_BARS.length;
  const slot = ((index % total) + total) % total;
  const targetIndex = slot % TARGET_GRID.length;
  const stopIndex = Math.floor(slot / TARGET_GRID.length) % STOP_GRID.length;
  const horizonIndex =
    Math.floor(slot / (TARGET_GRID.length * STOP_GRID.length)) % HORIZON_BARS.length;
  return {
    targetPct: TARGET_GRID[targetIndex],
    stopPct: STOP_GRID[stopIndex],
    bars: HORIZON_BARS[horizonIndex],
  };
}

export type DatasetOptions = {
  direction: PredictionDirection;
  combosPerBar: number;
  /** Take every Nth bar. Adjacent bars overlap heavily, so striding cuts redundancy. */
  stride: number;
  maxRows: number;
};

/**
 * Builds labelled rows for one symbol.
 *
 * Look-ahead safety rests on two invariants: features at bar `i` are produced by
 * `extractStateFeatures`, which reads `[0..i]` only, and the loop stops at
 * `length - 1 - MAX_HORIZON_BARS` so every row has its full outcome window
 * already in the data. A bar whose outcome is still unfolding is never labelled.
 */
export function buildSymbolDataset(
  context: SymbolContext,
  market: MarketContext | null,
  options: DatasetOptions,
): Dataset {
  const rows: LabelledRow[] = [];
  const base = context.base;
  const highs = base.high;
  const lows = base.low;
  const lastEntry = base.length - 1 - MAX_HORIZON_BARS;
  let ambiguousCount = 0;
  let skippedBars = 0;

  for (let i = FEATURE_WARMUP_BARS; i <= lastEntry; i += options.stride) {
    if (rows.length >= options.maxRows) break;
    const state = extractStateFeatures(context, i, market);
    if (!state) {
      skippedBars += 1;
      continue;
    }
    const sigmaBar = base.sigmaBar[i];
    if (sigmaBar == null || !(sigmaBar > 0)) {
      skippedBars += 1;
      continue;
    }
    const entryPrice = base.close[i];
    if (!(entryPrice > 0)) {
      skippedBars += 1;
      continue;
    }

    for (let c = 0; c < options.combosPerBar; c += 1) {
      const combo = comboAt(i * 7 + c * 61);
      const features = new Float64Array(FEATURE_COUNT);
      features.set(state, 0);
      const priors = writeBarrierFeatures(features, STATE_FEATURE_COUNT, combo, sigmaBar);
      // Barriers many sigmas away carry no information beyond "impossible".
      if (features[STATE_FEATURE_COUNT] >= 8) continue;

      const resolved = resolveFirstTouch(
        highs,
        lows,
        i,
        entryPrice,
        options.direction,
        combo.targetPct,
        combo.stopPct,
        combo.bars,
      );
      if (resolved.ambiguous) ambiguousCount += 1;
      rows.push({
        time: context.candles[i].openTime,
        symbol: context.symbol,
        features,
        targetFirst: resolved.outcome === "TARGET" ? 1 : 0,
        stopFirst: resolved.outcome === "STOP" ? 1 : 0,
        priorTarget: priors.priorTarget,
        priorStop: priors.priorStop,
        ambiguous: resolved.ambiguous,
      });
    }
  }

  return { rows, ambiguousCount, skippedBars };
}

if (BARRIER_FEATURE_COUNT + STATE_FEATURE_COUNT !== FEATURE_COUNT) {
  throw new Error("Feature layout mismatch");
}
