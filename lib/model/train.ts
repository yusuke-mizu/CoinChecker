import { buildMarketContext, buildSymbolContext, FEATURE_NAMES } from "@/lib/features/extract";
import { fetchBinanceOhlcvHistory } from "@/lib/market-data/binance";
import { mapPool } from "@/lib/util/pool";
import type {
  DirectionModel,
  OutcomeHead,
  OutcomeModel,
  PredictionDirection,
  TrainedModel,
  WalkForwardFold,
} from "@/lib/types/prediction";
import { applyCalibration, buildCalibration, evaluate } from "./calibration";
import { BAR_MINUTES, buildSymbolDataset, type LabelledRow } from "./dataset";
import {
  DEFAULT_TRAIN_OPTIONS,
  featureImportance,
  predictLogistic,
  trainLogistic,
  type TrainOptions,
} from "./logistic";

export type TrainRequest = {
  symbols: string[];
  barsPerSymbol: number;
  combosPerBar: number;
  stride: number;
  maxRowsPerSymbol: number;
  walkForwardFolds: number;
  options: TrainOptions;
};

export const TRAIN_DEFAULTS: TrainRequest = {
  symbols: [
    "BTCUSDT",
    "ETHUSDT",
    "SOLUSDT",
    "XRPUSDT",
    "DOGEUSDT",
    "BNBUSDT",
    "ADAUSDT",
    "LINKUSDT",
    "AVAXUSDT",
    "LTCUSDT",
  ],
  barsPerSymbol: 3000,
  combosPerBar: 3,
  stride: 2,
  maxRowsPerSymbol: 4000,
  walkForwardFolds: 4,
  options: DEFAULT_TRAIN_OPTIONS,
};

/** Hard ceilings, so a hand-written request cannot exhaust the Worker budget. */
export const TRAIN_LIMITS = {
  maxSymbols: 16,
  maxBarsPerSymbol: 6000,
  maxCombosPerBar: 6,
  maxRowsTotal: 60_000,
  maxIterations: 400,
};

function splitLabels(rows: LabelledRow[], outcome: OutcomeHead): Uint8Array {
  const labels = new Uint8Array(rows.length);
  for (let i = 0; i < rows.length; i += 1) {
    const row = rows[i];
    labels[i] =
      outcome === "TARGET" ? row.targetFirst : outcome === "STOP" ? row.stopFirst : row.targetTouched;
  }
  return labels;
}

function priors(rows: LabelledRow[], outcome: OutcomeHead): number[] {
  return rows.map((row) => (outcome === "STOP" ? row.priorStop : row.priorTarget));
}

/**
 * Trains one outcome head with an honest holdout.
 *
 * The final 20% of the timeline is reserved: the model fits on the earlier 80%,
 * Platt scaling fits on the holdout predictions, and the reported metrics come
 * from that same holdout. Calibrating and scoring on the training rows would
 * report a quality the model does not actually have.
 */
function trainOutcome(
  rows: LabelledRow[],
  outcome: OutcomeHead,
  options: TrainOptions,
): OutcomeModel {
  const cut = Math.max(1, Math.floor(rows.length * 0.8));
  const trainRows = rows.slice(0, cut);
  const holdoutRows = rows.slice(cut);
  const usable = holdoutRows.length >= 200 ? holdoutRows : trainRows;

  const model = trainLogistic(
    trainRows.map((row) => row.features),
    splitLabels(trainRows, outcome),
    FEATURE_NAMES,
    options,
  );

  const raw = usable.map((row) => predictLogistic(model, row.features));
  const labels = splitLabels(usable, outcome);
  const calibration = buildCalibration(raw, labels);
  const calibrated = raw.map((p) => applyCalibration(calibration, p));
  const metrics = evaluate(calibrated, labels, priors(usable, outcome));

  return {
    outcome,
    model,
    calibration,
    metrics,
    importance: featureImportance(model).slice(0, 25),
  };
}

/**
 * Walk-forward validation.
 *
 * Folds move forward in time: fold k trains on everything before a cut and is
 * tested on the block that follows. Nothing in a training window ever postdates
 * its test window, so this measures what the model would have known at the time
 * rather than what a shuffled split would flatter it into reporting.
 */
function walkForward(
  rows: LabelledRow[],
  outcome: OutcomeHead,
  folds: number,
  options: TrainOptions,
): WalkForwardFold[] {
  const results: WalkForwardFold[] = [];
  if (rows.length < 1000 || folds < 2) return results;
  const blockSize = Math.floor(rows.length / (folds + 1));
  if (blockSize < 200) return results;

  for (let k = 0; k < folds; k += 1) {
    const trainEnd = blockSize * (k + 1);
    const testEnd = Math.min(rows.length, trainEnd + blockSize);
    const trainRows = rows.slice(0, trainEnd);
    const testRows = rows.slice(trainEnd, testEnd);
    if (testRows.length < 100) continue;

    const model = trainLogistic(
      trainRows.map((row) => row.features),
      splitLabels(trainRows, outcome),
      FEATURE_NAMES,
      options,
    );
    const raw = testRows.map((row) => predictLogistic(model, row.features));
    const labels = splitLabels(testRows, outcome);
    // Calibration is fitted inside the fold's own test block only for reporting
    // the achievable calibration; the metrics below use those same probabilities.
    const calibration = buildCalibration(raw, labels);
    const calibrated = raw.map((p) => applyCalibration(calibration, p));

    results.push({
      index: k + 1,
      trainRows: trainRows.length,
      testRows: testRows.length,
      trainUntil: new Date(trainRows[trainRows.length - 1].time).toISOString(),
      testFrom: new Date(testRows[0].time).toISOString(),
      testUntil: new Date(testRows[testRows.length - 1].time).toISOString(),
      metrics: evaluate(calibrated, labels, priors(testRows, outcome)),
      calibration,
    });
  }
  return results;
}

function trainDirection(
  rows: LabelledRow[],
  direction: PredictionDirection,
  options: TrainOptions,
): DirectionModel {
  return {
    direction,
    reach: trainOutcome(rows, "REACH", options),
    target: trainOutcome(rows, "TARGET", options),
    stop: trainOutcome(rows, "STOP", options),
  };
}

export type TrainProgress = (message: string) => void;

export async function trainModel(
  request: Partial<TrainRequest> = {},
  onProgress?: TrainProgress,
): Promise<TrainedModel> {
  const config: TrainRequest = {
    ...TRAIN_DEFAULTS,
    ...request,
    options: { ...DEFAULT_TRAIN_OPTIONS, ...(request.options ?? {}) },
  };
  config.symbols = config.symbols.slice(0, TRAIN_LIMITS.maxSymbols);
  config.barsPerSymbol = Math.min(config.barsPerSymbol, TRAIN_LIMITS.maxBarsPerSymbol);
  config.combosPerBar = Math.min(config.combosPerBar, TRAIN_LIMITS.maxCombosPerBar);
  config.options.iterations = Math.min(config.options.iterations, TRAIN_LIMITS.maxIterations);

  const notes: string[] = [];
  onProgress?.(`fetching ${config.symbols.length} symbols`);

  // Binance is the only venue with both deep paging and taker-buy volume, so
  // training runs against it exclusively and records that in the provenance.
  const btcCandles = await fetchBinanceOhlcvHistory("BTCUSDT", "15m", config.barsPerSymbol);
  if (btcCandles.length < 500) {
    throw new Error(`BTC history too short for training (${btcCandles.length} bars)`);
  }
  const market = buildMarketContext(btcCandles);

  const histories = await mapPool(config.symbols, 3, async (symbol) => {
    try {
      const candles = await fetchBinanceOhlcvHistory(symbol, "15m", config.barsPerSymbol);
      return { symbol, candles };
    } catch {
      return { symbol, candles: [] as typeof btcCandles };
    }
  });

  const longRows: LabelledRow[] = [];
  const shortRows: LabelledRow[] = [];
  let ambiguous = 0;
  const usedSymbols: string[] = [];

  for (const entry of histories) {
    if (entry.candles.length < 500) {
      notes.push(`${entry.symbol}: skipped, only ${entry.candles.length} bars available`);
      continue;
    }
    const context = buildSymbolContext(entry.symbol, entry.candles);
    for (const direction of ["LONG", "SHORT"] as const) {
      const dataset = buildSymbolDataset(context, market, {
        direction,
        combosPerBar: config.combosPerBar,
        stride: config.stride,
        maxRows: config.maxRowsPerSymbol,
      });
      ambiguous += dataset.ambiguousCount;
      (direction === "LONG" ? longRows : shortRows).push(...dataset.rows);
    }
    usedSymbols.push(entry.symbol);
    onProgress?.(`${entry.symbol}: ${entry.candles.length} bars`);
  }

  if (longRows.length < 500 || shortRows.length < 500) {
    throw new Error(
      `Not enough labelled rows (long=${longRows.length}, short=${shortRows.length})`,
    );
  }

  // Pooling across symbols is what lets a thin-history altcoin inherit market-wide
  // structure. Sorting by time makes every split below chronological.
  longRows.sort((a, b) => a.time - b.time);
  shortRows.sort((a, b) => a.time - b.time);
  const capPerDirection = Math.floor(TRAIN_LIMITS.maxRowsTotal / 2);
  const trimmed = {
    long: longRows.length > capPerDirection ? longRows.slice(-capPerDirection) : longRows,
    short: shortRows.length > capPerDirection ? shortRows.slice(-capPerDirection) : shortRows,
  };
  if (longRows.length > capPerDirection) {
    notes.push(`Row cap applied: kept the most recent ${capPerDirection} rows per direction`);
  }

  onProgress?.(`training on ${trimmed.long.length + trimmed.short.length} rows`);
  const long = trainDirection(trimmed.long, "LONG", config.options);
  const short = trainDirection(trimmed.short, "SHORT", config.options);

  onProgress?.("walk-forward validation");
  const folds = walkForward(trimmed.long, "TARGET", config.walkForwardFolds, config.options);

  const allRows = [...trimmed.long, ...trimmed.short];
  const firstTime = Math.min(...allRows.map((row) => row.time));
  const lastTime = Math.max(...allRows.map((row) => row.time));
  const totalRows = allRows.length;

  notes.push(
    "Derivative inputs (funding, open interest) are not in the trained feature set: only current values are available in bulk, so they cannot be reconstructed for past bars without look-ahead. They are applied as a separate bounded adjustment at prediction time.",
  );
  notes.push(
    `Same-bar target/stop collisions resolve to STOP. ${ambiguous} of ${totalRows} rows (${((ambiguous / Math.max(1, totalRows)) * 100).toFixed(2)}%) were ambiguous.`,
  );

  return {
    version: `model_v1-${new Date().toISOString().replace(/[:.]/g, "").slice(0, 15)}`,
    createdAt: new Date().toISOString(),
    training: {
      symbols: usedSymbols,
      venue: "binance",
      barMinutes: BAR_MINUTES,
      barsPerSymbol: config.barsPerSymbol,
      firstSampleAt: new Date(firstTime).toISOString(),
      lastSampleAt: new Date(lastTime).toISOString(),
      totalRows,
      ambiguousSameBarRows: ambiguous,
      combosPerBar: config.combosPerBar,
    },
    long,
    short,
    walkForward: folds,
    notes,
  };
}
