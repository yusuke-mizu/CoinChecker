import type {
  Bucket,
  MonteCarloResult,
  MonteCarloSettings,
  SimTrade,
  TradePopulation,
} from "@/lib/types/simulation";

/** Deterministic PRNG so a seed always reproduces the same set of paths. */
function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pathSeed(seed: number, pathIndex: number): number {
  return (seed + Math.imul(pathIndex + 1, 2654435761)) >>> 0;
}

export type PathOutcome = {
  finalCapital: number;
  maxDrawdownPct: number;
  ruined: boolean;
  tradesToTarget: number | null;
  curve: number[];
};

/**
 * One equity path built by resampling the realized trade population.
 *
 * Sampling is in R-multiples, so leverage and position size are applied here
 * rather than baked into the population. With `blockSize > 1` contiguous runs of
 * trades are drawn together, which preserves win/loss streaks that plain iid
 * resampling destroys.
 */
export function simulatePath(
  rMultiples: number[],
  settings: MonteCarloSettings,
  pathIndex: number,
  keepCurve = false,
): PathOutcome {
  const random = mulberry32(pathSeed(settings.seed, pathIndex));
  const block = Math.max(1, Math.min(settings.blockSize, rMultiples.length));
  const ruinFloor = (settings.initialCapital * settings.ruinThresholdPct) / 100;
  let capital = settings.initialCapital;
  let peak = capital;
  let maxDrawdownPct = 0;
  let ruined = false;
  let tradesToTarget: number | null = null;
  const curve: number[] = keepCurve ? [capital] : [];

  let cursor = Math.floor(random() * rMultiples.length);
  let remainingInBlock = 0;

  for (let step = 0; step < settings.tradesPerPath; step += 1) {
    if (remainingInBlock <= 0) {
      cursor = Math.floor(random() * rMultiples.length);
      remainingInBlock = block;
    }
    const r = rMultiples[cursor % rMultiples.length];
    cursor += 1;
    remainingInBlock -= 1;

    const riskBase = settings.compounding ? capital : settings.initialCapital;
    capital = Math.max(0, capital + (riskBase * settings.riskPerTradePct * r) / 100);
    if (keepCurve) curve.push(capital);

    peak = Math.max(peak, capital);
    if (peak > 0) {
      maxDrawdownPct = Math.max(maxDrawdownPct, ((peak - capital) / peak) * 100);
    }
    if (tradesToTarget == null && capital >= settings.targetCapital) {
      tradesToTarget = step + 1;
    }
    if (capital <= ruinFloor) {
      ruined = true;
      break;
    }
  }

  return { finalCapital: capital, maxDrawdownPct, ruined, tradesToTarget, curve };
}

function percentile(sorted: number[], fraction: number): number {
  if (sorted.length === 0) return 0;
  const position = (sorted.length - 1) * fraction;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return sorted[lower];
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower);
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return percentile(sorted, 0.5);
}

const CAPITAL_MULTIPLES = [0, 0.25, 0.5, 1, 2, 5, 10, 100, 1000];

function capitalHistogram(finals: number[], initial: number): Bucket[] {
  return CAPITAL_MULTIPLES.map((low, index) => {
    const high = CAPITAL_MULTIPLES[index + 1];
    const lowValue = low * initial;
    const highValue = high == null ? Number.POSITIVE_INFINITY : high * initial;
    return {
      label: high == null ? `>= ${low}x` : `${low}〜${high}x`,
      count: finals.filter((value) => value >= lowValue && value < highValue).length,
    };
  });
}

/** Calendar throughput of the realized population, used to convert trades into days. */
export function tradesPerDay(trades: SimTrade[]): number | null {
  if (trades.length < 2) return null;
  const times = trades.map((trade) => trade.entryTime);
  const span = Math.max(...times) - Math.min(...times);
  if (span <= 0) return null;
  return trades.length / (span / 86_400_000);
}

export function buildPopulation(trades: SimTrade[]): TradePopulation {
  return {
    rMultiples: trades
      .map((trade) => trade.rMultiple)
      .filter((value) => Number.isFinite(value)),
    tradesPerDay: tradesPerDay(trades),
  };
}

export type MonteCarloProgress = (completed: number, total: number) => void;

/**
 * Runs the requested number of paths in batches, yielding to the event loop
 * between batches so the browser stays responsive during 10,000-path runs.
 */
export async function runMonteCarlo(
  population: TradePopulation,
  settings: MonteCarloSettings,
  onProgress?: MonteCarloProgress,
  yieldToEventLoop: () => Promise<void> = () => new Promise((resolve) => setTimeout(resolve, 0)),
): Promise<MonteCarloResult> {
  const rMultiples = population.rMultiples.filter((value) => Number.isFinite(value));
  if (rMultiples.length === 0) {
    throw new Error("Monte Carloに使用できるTrade結果がありません。先にBacktestを実行してください。");
  }

  const finals: number[] = [];
  const drawdowns: number[] = [];
  const targetHits: number[] = [];
  let ruinCount = 0;
  let beyondDrawdown = 0;
  const batchSize = 250;

  for (let start = 0; start < settings.paths; start += batchSize) {
    const end = Math.min(start + batchSize, settings.paths);
    for (let pathIndex = start; pathIndex < end; pathIndex += 1) {
      const outcome = simulatePath(rMultiples, settings, pathIndex);
      finals.push(outcome.finalCapital);
      drawdowns.push(outcome.maxDrawdownPct);
      if (outcome.ruined) ruinCount += 1;
      if (outcome.maxDrawdownPct > settings.drawdownThresholdPct) beyondDrawdown += 1;
      if (outcome.tradesToTarget != null) targetHits.push(outcome.tradesToTarget);
    }
    onProgress?.(end, settings.paths);
    if (end < settings.paths) await yieldToEventLoop();
  }

  const sortedFinals = [...finals].sort((a, b) => a - b);
  const sortedDrawdowns = [...drawdowns].sort((a, b) => a - b);
  const medianFinal = percentile(sortedFinals, 0.5);
  // Re-run the path closest to the median with the same seed to recover its curve.
  let medianPathIndex = 0;
  let closest = Number.POSITIVE_INFINITY;
  for (let index = 0; index < finals.length; index += 1) {
    const distance = Math.abs(finals[index] - medianFinal);
    if (distance < closest) {
      closest = distance;
      medianPathIndex = index;
    }
  }
  const medianPath = simulatePath(rMultiples, settings, medianPathIndex, true);
  const throughput = population.tradesPerDay;
  const medianTrades = median(targetHits);

  return {
    settings,
    sampleSize: rMultiples.length,
    medianFinalCapital: medianFinal,
    meanFinalCapital: finals.reduce((sum, value) => sum + value, 0) / finals.length,
    bestCase: sortedFinals[sortedFinals.length - 1],
    worstCase: sortedFinals[0],
    percentiles: {
      p5: percentile(sortedFinals, 0.05),
      p25: percentile(sortedFinals, 0.25),
      p50: medianFinal,
      p75: percentile(sortedFinals, 0.75),
      p95: percentile(sortedFinals, 0.95),
    },
    probabilityOfLoss:
      (finals.filter((value) => value < settings.initialCapital).length / finals.length) * 100,
    probabilityOfDrawdownBeyondThreshold: (beyondDrawdown / finals.length) * 100,
    probabilityOfRuin: (ruinCount / finals.length) * 100,
    medianMaxDrawdownPct: percentile(sortedDrawdowns, 0.5),
    worstMaxDrawdownPct: sortedDrawdowns[sortedDrawdowns.length - 1],
    targetReachProbability: (targetHits.length / finals.length) * 100,
    medianTradesToTarget: medianTrades,
    medianDaysToTarget:
      medianTrades != null && throughput != null && throughput > 0
        ? medianTrades / throughput
        : null,
    medianPathCurve: medianPath.curve,
    finalCapitalHistogram: capitalHistogram(finals, settings.initialCapital),
  };
}

export const DEFAULT_MONTE_CARLO: MonteCarloSettings = {
  paths: 1000,
  tradesPerPath: 200,
  initialCapital: 10_000,
  riskPerTradePct: 2,
  blockSize: 5,
  ruinThresholdPct: 10,
  drawdownThresholdPct: 30,
  targetCapital: 100_000_000,
  compounding: true,
  seed: 12345,
};
