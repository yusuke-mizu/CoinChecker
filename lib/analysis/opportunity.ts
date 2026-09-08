import { emaSeries, rsiWilder } from "@/lib/indicators";
import {
  BARRIER_GRID,
  blendWeight,
  clamp,
  estimateBasis,
  logBarrier,
  logit,
  modelPairSplit,
  scanFirstTouch,
  sigmoid,
  snapToGrid,
  stateFeatures,
  touchProbability,
  volatilityModel,
  weightSamples,
  type FirstTouchSample,
  type VolatilityModel,
} from "@/lib/scoring/first-passage";
import { buildSymbolContext, type MarketContext } from "@/lib/features/extract";
import { FEATURE_WARMUP_BARS } from "@/lib/features/feature-series";
import {
  buildLiveFeatures,
  confidenceScore,
  predictorFor,
  REQUIRED_BARS,
  type SymbolPredictor,
} from "@/lib/model/predict";
import type { BulkDerivativeStats } from "@/lib/market-data/bulk-derivatives";
import type { Candle, TickerSnapshot } from "@/lib/types/market";
import type { TrainedModel } from "@/lib/types/prediction";
import type { CandleVenue } from "@/lib/types/venue";
import type {
  BtcRegime,
  EstimateBasis,
  HorizonEstimate,
  HoldingPlan,
  LeveragePlan,
  OpportunityDirection,
  OpportunityRow,
  OpportunitySide,
  OpportunityVerdict,
  StopAnchor,
  StopPlan,
  TargetOption,
} from "@/lib/types/opportunity";

/**
 * "If I enter at the current price, how far is this likely to go, and where
 * should I get out?" for one symbol, in both directions, from a single 15m
 * candle request.
 *
 * Everything here is derived from one historical first-passage scan plus a
 * volatility model, so the whole universe can be evaluated cheaply. The output
 * is an estimate conditioned on past behaviour in similar states -- not a
 * forecast, and never a guarantee.
 */

export const BAR_MINUTES = 15;
/**
 * 900 bars is set by the 4h feature block: EMA50 on 4h needs 50 closed 4h bars,
 * which is 800 base bars, plus warmup headroom. Fetching less would leave those
 * columns imputed at prediction time while they were real during training.
 */
export const CANDLE_LIMIT = 900;
/** Below this the model's feature stack cannot be filled honestly. */
const MODEL_MIN_CANDLES = FEATURE_WARMUP_BARS + 640;
/** 60 warmup bars + 16 horizon bars + enough tail to weight. */
const MIN_CANDLES = 140;
const MIN_SAMPLES = 50;

export const HORIZON_SPECS = [
  { label: "15分", minutes: 15, bars: 1, levelPct: 0.5 },
  { label: "30分", minutes: 30, bars: 2, levelPct: 0.5 },
  { label: "1時間", minutes: 60, bars: 4, levelPct: 1 },
  { label: "2時間", minutes: 120, bars: 8, levelPct: 1 },
  { label: "4時間", minutes: 240, bars: 16, levelPct: 2 },
] as const;

const HORIZON_BARS = HORIZON_SPECS.map((spec) => spec.bars);
const TARGET_GRID = [0.5, 1, 1.5, 2, 3, 5];

/** Taker cost per side, percent of notional. Conservative on purpose. */
const TAKER_FEE_PCT = 0.05;
const SLIPPAGE_PCT = 0.02;
const ROUND_TRIP_COST_PCT = 2 * (TAKER_FEE_PCT + SLIPPAGE_PCT);
const MAX_TILT = 0.7;
const MAX_STOP_PCT = 5;
/** Below this chance of being reached, a target is not worth planning around. */
const MIN_TARGET_PROBABILITY = 0.15;
/** Wicks make anything higher a liquidation hazard on a short-horizon trade. */
const MAX_LEVERAGE = 15;

/** Loss of margin tolerated at the stop, percent, per risk appetite. */
const RISK_BUDGET = { conservative: 3, recommended: 6, aggressive: 12 };
const MAINTENANCE_MARGIN_PCT = 0.5;

function atrPctOf(candles: Candle[], period = 14): number | null {
  if (candles.length < period + 1) return null;
  let sum = 0;
  for (let i = candles.length - period; i < candles.length; i += 1) {
    const previous = candles[i - 1].close;
    sum += Math.max(
      candles[i].high - candles[i].low,
      Math.abs(candles[i].high - previous),
      Math.abs(candles[i].low - previous),
    );
  }
  const last = candles[candles.length - 1].close;
  if (!(last > 0)) return null;
  return (sum / period / last) * 100;
}

function returnPct(candles: Candle[], barsBack: number): number | null {
  if (candles.length <= barsBack) return null;
  const from = candles[candles.length - 1 - barsBack].close;
  if (!(from > 0)) return null;
  return ((candles[candles.length - 1].close - from) / from) * 100;
}

function extremes(candles: Candle[], bars: number): { high: number; low: number } {
  const start = Math.max(0, candles.length - bars);
  let high = -Infinity;
  let low = Infinity;
  for (let i = start; i < candles.length; i += 1) {
    high = Math.max(high, candles[i].high);
    low = Math.min(low, candles[i].low);
  }
  return { high, low };
}

/** Signed taker flow, -1..1. Requires venue-reported taker buy volume. */
function orderFlowDelta(candles: Candle[], bars: number): number | null {
  const start = Math.max(0, candles.length - bars);
  let signed = 0;
  let total = 0;
  for (let i = start; i < candles.length; i += 1) {
    const taker = candles[i].takerBuyVolume;
    if (taker == null) return null;
    signed += 2 * taker - candles[i].volume;
    total += candles[i].volume;
  }
  return total > 0 ? clamp(signed / total, -1, 1) : null;
}

function volumeRatioOf(candles: Candle[]): number | null {
  if (candles.length < 21) return null;
  let sum = 0;
  for (let i = candles.length - 21; i < candles.length - 1; i += 1) sum += candles[i].volume;
  const average = sum / 20;
  return average > 0 ? candles[candles.length - 1].volume / average : null;
}

function minutesLabel(minMinutes: number, maxMinutes: number): string {
  const format = (minutes: number) =>
    minutes >= 60 && minutes % 60 === 0 ? `${minutes / 60}時間` : `${minutes}分`;
  if (minMinutes === maxMinutes) return format(maxMinutes);
  if (maxMinutes < 60) return `${minMinutes}〜${maxMinutes}分`;
  if (minMinutes % 60 === 0 && maxMinutes % 60 === 0) {
    return `${minMinutes / 60}〜${maxMinutes / 60}時間`;
  }
  return `${minMinutes}分〜${format(maxMinutes)}`;
}

type MarketState = {
  entryPrice: number;
  atrPct: number;
  rsi: number | null;
  trend: "UP" | "DOWN" | "FLAT";
  position96: number | null;
  volumeRatio: number | null;
  orderFlow: number | null;
  return2hPct: number | null;
  swing: { high: number; low: number };
  structure: { high: number; low: number };
  fundingRatePct: number | null;
  isBtc: boolean;
};

function buildTilt(
  direction: OpportunityDirection,
  state: MarketState,
  regime: BtcRegime,
): { total: number; reasons: string[] } {
  const isLong = direction === "LONG";
  const reasons: string[] = [];
  let total = 0;
  const push = (label: string, delta: number) => {
    total += delta;
    if (Math.abs(delta) >= 0.08) reasons.push(label);
  };

  if (state.trend !== "FLAT") {
    const aligned = (state.trend === "UP") === isLong;
    push(aligned ? "短期Trend順行" : "短期Trend逆行", aligned ? 0.15 : -0.18);
  }

  if (state.rsi != null) {
    const stretched = isLong ? state.rsi >= 78 : state.rsi <= 22;
    const washedOut = isLong ? state.rsi <= 28 : state.rsi >= 72;
    if (stretched) push(isLong ? "RSI過熱" : "RSI売られ過ぎ", -0.28);
    else if (washedOut) push("逆張り余地あり", 0.1);
  }

  if (state.return2hPct != null && state.atrPct > 0) {
    const extension = state.return2hPct / state.atrPct;
    const chasing = isLong ? extension >= 2.5 : extension <= -2.5;
    if (chasing) push("直近2時間で伸び切り(Chase Risk)", -0.25);
  }

  if (state.position96 != null) {
    if (isLong ? state.position96 >= 90 : state.position96 <= 10) push("24時間レンジ端", -0.2);
    else if (isLong ? state.position96 <= 20 : state.position96 >= 80) push("押し目/戻り位置", 0.12);
  }

  if (state.fundingRatePct != null) {
    const adverse = isLong ? state.fundingRatePct : -state.fundingRatePct;
    if (adverse >= 0.05) push("Funding逆風(同方向が混雑)", -0.15);
    else if (adverse <= -0.03) push("Funding順風", 0.1);
  }

  if (state.orderFlow != null) {
    const aligned = isLong ? state.orderFlow : -state.orderFlow;
    if (aligned >= 0.08) push("Taker Flow順行", 0.12);
    else if (aligned <= -0.08) push("Taker Flow逆行", -0.12);
  }

  if (state.volumeRatio != null) {
    if (state.volumeRatio >= 1.4) push("出来高増加", 0.08);
    else if (state.volumeRatio <= 0.6) push("出来高低下", -0.08);
  }

  if (!state.isBtc) {
    if (regime.state === "RISK_OFF" && isLong) push("BTC Regime悪化", -0.2);
    else if (regime.state === "RISK_ON" && isLong) push("BTC Regime良好", 0.1);
    else if (regime.state === "RISK_OFF" && !isLong) push("BTC下落局面と順行", 0.1);
  }

  const barrier = isLong ? state.structure.high : state.structure.low;
  if (Number.isFinite(barrier) && state.entryPrice > 0 && state.atrPct > 0) {
    const distance = (Math.abs(barrier - state.entryPrice) / state.entryPrice) * 100;
    if (distance < state.atrPct * 0.5) push(isLong ? "上に抵抗帯" : "下に支持帯", -0.2);
    else if (distance > state.atrPct * 2.5) push("障害まで余裕あり", 0.08);
  }

  return { total: clamp(total, -MAX_TILT, MAX_TILT), reasons };
}

function stopCandidates(direction: OpportunityDirection, state: MarketState): StopPlan[] {
  const isLong = direction === "LONG";
  const { atrPct, entryPrice } = state;
  const distanceTo = (level: number) =>
    Number.isFinite(level) && entryPrice > 0
      ? (Math.abs(entryPrice - level) / entryPrice) * 100
      : null;

  const raw: Array<{ pct: number; anchor: StopAnchor; atrMultiple: number | null; reason: string }> = [
    {
      pct: atrPct * 1,
      anchor: "ATR",
      atrMultiple: 1,
      reason: "短期ATR 1.0倍の通常逆行幅",
    },
    {
      pct: atrPct * 1.6,
      anchor: "ATR",
      atrMultiple: 1.6,
      reason: "短期ATR 1.6倍のノイズ回避幅",
    },
  ];

  const swing = distanceTo(isLong ? state.swing.low : state.swing.high);
  if (swing != null) {
    raw.push({
      pct: swing + atrPct * 0.3,
      anchor: "SWING",
      atrMultiple: null,
      reason: `直近6時間の${isLong ? "Swing Low下抜け" : "Swing High上抜け"} + ATRバッファ`,
    });
  }
  const structure = distanceTo(isLong ? state.structure.low : state.structure.high);
  if (structure != null && structure + atrPct * 0.3 <= MAX_STOP_PCT) {
    raw.push({
      pct: structure + atrPct * 0.3,
      anchor: "STRUCTURE",
      atrMultiple: null,
      reason: `24時間${isLong ? "Support下抜け" : "Resistance上抜け"} + ATRバッファ`,
    });
  }

  // Stops inside the noise band get run over; stops beyond MAX_STOP_PCT are not
  // a short-horizon trade any more.
  const floorPct = Math.max(BARRIER_GRID[0], atrPct * 0.5);
  const ceilingPct = Math.max(floorPct, Math.min(MAX_STOP_PCT, atrPct * 4));

  const seen = new Set<number>();
  const plans: StopPlan[] = [];
  for (const candidate of raw) {
    if (!Number.isFinite(candidate.pct) || candidate.pct <= 0) continue;
    const { value, index } = snapToGrid(clamp(candidate.pct, floorPct, ceilingPct));
    if (seen.has(index)) continue;
    seen.add(index);
    plans.push({
      pct: value,
      price: entryPrice * (1 - ((isLong ? 1 : -1) * value) / 100),
      anchor: candidate.anchor,
      atrMultiple: candidate.atrMultiple,
      reason: candidate.reason,
    });
  }
  return plans;
}

function leverageFor(input: {
  stopPct: number;
  atrPct: number;
  regime: BtcRegime;
  fundingRatePct: number | null;
  adverseExcursionPct: number | null;
}): LeveragePlan {
  const { stopPct, atrPct, regime } = input;
  const caps: string[] = [];

  // Liquidation must sit well beyond the stop, including typical overshoot.
  const liquidationCap = Math.floor(100 / (stopPct * 1.6 + MAINTENANCE_MARGIN_PCT));
  let ceiling = Math.max(1, Math.min(MAX_LEVERAGE, liquidationCap));
  if (liquidationCap < MAX_LEVERAGE) caps.push(`Liquidation余裕から上限${liquidationCap}x`);

  const volatilityCap =
    atrPct >= 2.5 ? 3 : atrPct >= 1.5 ? 5 : atrPct >= 0.8 ? 10 : MAX_LEVERAGE;
  if (volatilityCap < ceiling) {
    ceiling = volatilityCap;
    caps.push(`高ボラティリティ(ATR ${atrPct.toFixed(2)}%)で上限${volatilityCap}x`);
  }

  if (input.adverseExcursionPct != null && input.adverseExcursionPct > 0) {
    const excursionCap = Math.floor(100 / (input.adverseExcursionPct * 1.5 + MAINTENANCE_MARGIN_PCT));
    if (excursionCap < ceiling) {
      ceiling = Math.max(1, excursionCap);
      caps.push(`過去の最大逆行幅から上限${Math.max(1, excursionCap)}x`);
    }
  }

  if (regime.state === "RISK_OFF" && ceiling > 5) {
    ceiling = 5;
    caps.push("BTC Regime悪化で上限5x");
  }

  if (input.fundingRatePct != null && Math.abs(input.fundingRatePct) >= 0.1 && ceiling > 5) {
    ceiling = 5;
    caps.push("Funding負担が大きく上限5x");
  }

  const band = (budget: number): [number, number] => {
    const max = clamp(Math.floor(Math.min(budget / stopPct, ceiling)), 1, MAX_LEVERAGE);
    return [clamp(Math.floor(max * 0.65), 1, max), max];
  };

  const [conservativeMin, conservativeMax] = band(RISK_BUDGET.conservative);
  const [recommendedMin, recommendedMax] = band(RISK_BUDGET.recommended);
  const [aggressiveMin, aggressiveMax] = band(RISK_BUDGET.aggressive);
  return {
    recommendedMin,
    recommendedMax,
    conservativeMin,
    conservativeMax,
    aggressiveMin,
    aggressiveMax,
    maxSafe: ceiling,
    caps,
  };
}

type Estimator = {
  samples: FirstTouchSample[];
  weightTotal: number;
  lambda: number;
  model: VolatilityModel;
  tilt: number;
};

/**
 * The probability source, behind an interface.
 *
 * Two implementations exist. `learnedEngine` is the trained cross-symbol model:
 * features in, calibrated first-passage probabilities out. `historicalEngine`
 * is the original kernel-weighted historical scan blended with a random-walk
 * model, and it still runs whenever no model is published or a symbol has too
 * little history to feed one. Everything downstream -- stop selection, target
 * selection, expected value, leverage, holding window -- is shared, so the two
 * paths differ only in where the numbers come from.
 */
export type ProbabilityEngine = {
  basis: EstimateBasis;
  /** P(price travels `pct` in the favourable/adverse direction within `bars`). */
  touch(pct: number, bars: number, favorable: boolean): number;
  /** P(target first) and P(stop first) for a specific pair. */
  pair(targetPct: number, stopPct: number, bars: number): { target: number; stop: number };
  /** Features that moved the estimate, for the "why" panel. Empty when rule-based. */
  drivers(targetPct: number, stopPct: number, bars: number): string[];
};

/** Blended probability of touching a grid distance inside `bars`. */
function touchAt(
  estimator: Estimator,
  gridIndex: number,
  bars: number,
  isLong: boolean,
  favorable: boolean,
): number {
  const { samples, weightTotal, lambda, model, tilt } = estimator;
  const up = favorable === isLong;
  let weighted = 0;
  for (const sample of samples) {
    const first = up ? sample.firstUp[gridIndex] : sample.firstDown[gridIndex];
    if (first <= bars) weighted += sample.weight;
  }
  const empirical = weighted / weightTotal;
  const modeled = touchProbability(
    logBarrier(BARRIER_GRID[gridIndex], up),
    model,
    bars,
    favorable,
  );
  const shift = favorable ? tilt : -tilt * 0.5;
  return clamp(sigmoid(logit(lambda * empirical + (1 - lambda) * modeled) + shift), 0, 1);
}

/** Blended probability that target / stop is touched first inside `bars`. */
function pairAt(
  estimator: Estimator,
  targetIndex: number,
  stopIndex: number,
  bars: number,
  isLong: boolean,
): { target: number; stop: number } {
  const { samples, weightTotal, lambda, model, tilt } = estimator;
  let targetFirst = 0;
  let stopFirst = 0;
  for (const sample of samples) {
    const favorableAt = isLong ? sample.firstUp[targetIndex] : sample.firstDown[targetIndex];
    const adverseAt = isLong ? sample.firstDown[stopIndex] : sample.firstUp[stopIndex];
    if (favorableAt <= bars && favorableAt < adverseAt) targetFirst += sample.weight;
    else if (adverseAt <= bars) stopFirst += sample.weight;
  }
  const modeled = modelPairSplit(
    logBarrier(BARRIER_GRID[targetIndex], isLong),
    logBarrier(BARRIER_GRID[stopIndex], !isLong),
    model,
    bars,
  );
  const target = clamp(
    sigmoid(logit(lambda * (targetFirst / weightTotal) + (1 - lambda) * modeled.target) + tilt),
    0,
    1,
  );
  const stop = clamp(
    sigmoid(logit(lambda * (stopFirst / weightTotal) + (1 - lambda) * modeled.stop) - tilt * 0.5),
    0,
    1,
  );
  const scale = target + stop > 1 ? 1 / (target + stop) : 1;
  return { target: target * scale, stop: stop * scale };
}

function historicalEngine(estimator: Estimator, isLong: boolean): ProbabilityEngine {
  return {
    basis: estimateBasis(estimator.lambda),
    touch: (pct, bars, favorable) =>
      touchAt(estimator, snapToGrid(pct).index, bars, isLong, favorable),
    pair: (targetPct, stopPct, bars) =>
      pairAt(estimator, snapToGrid(targetPct).index, snapToGrid(stopPct).index, bars, isLong),
    drivers: () => [],
  };
}

/** Weighted mean close-to-close result at a horizon, in the trade's direction. */
function driftAt(estimator: Estimator, horizonIndex: number, isLong: boolean): number {
  let weighted = 0;
  for (const sample of estimator.samples) {
    const directional = isLong
      ? sample.closeReturnPct[horizonIndex]
      : -sample.closeReturnPct[horizonIndex];
    weighted += sample.weight * directional;
  }
  return weighted / estimator.weightTotal;
}

function costFor(hours: number, fundingRatePct: number | null, isLong: boolean): number {
  const funding =
    fundingRatePct == null ? 0 : Math.max(0, (isLong ? fundingRatePct : -fundingRatePct)) * (hours / 8);
  return ROUND_TRIP_COST_PCT + funding;
}

function evaluateSide(input: {
  direction: OpportunityDirection;
  state: MarketState;
  estimator: Estimator;
  engine: ProbabilityEngine;
  regime: BtcRegime;
  confidence: number;
  tiltReasons: string[];
}): OpportunitySide | null {
  const { direction, state, estimator, engine, regime, confidence } = input;
  const isLong = direction === "LONG";
  const stops = stopCandidates(direction, state);
  if (stops.length === 0) return null;

  const targets = TARGET_GRID.map((pct) => snapToGrid(pct));
  const driftCache = HORIZON_SPECS.map((_, index) => driftAt(estimator, index, isLong));

  type Choice = {
    stop: StopPlan;
    targetPct: number;
    targetIndex: number;
    horizonIndex: number;
    target: number;
    stopProbability: number;
    neither: number;
    grossEv: number;
    cost: number;
    ev: number;
    evPerHour: number;
  };

  const evaluate = (
    stop: StopPlan,
    target: { value: number; index: number },
    horizonIndex: number,
  ): Choice | null => {
    if (target.value <= stop.pct) return null;
    const spec = HORIZON_SPECS[horizonIndex];
    const hours = spec.minutes / 60;
    const { target: pTarget, stop: pStop } = engine.pair(target.value, stop.pct, spec.bars);
    const pNeither = clamp(1 - pTarget - pStop, 0, 1);
    // Unresolved paths are marked to the modeled close, bounded by the barriers.
    const openResult = clamp(driftCache[horizonIndex], -stop.pct, target.value);
    const grossEv = pTarget * target.value - pStop * stop.pct + pNeither * openResult;
    const cost = costFor(hours, state.fundingRatePct, isLong);
    const ev = grossEv - cost;
    return {
      stop,
      targetPct: target.value,
      targetIndex: target.index,
      horizonIndex,
      target: pTarget,
      stopProbability: pStop,
      neither: pNeither,
      grossEv,
      cost,
      ev,
      evPerHour: ev / hours,
    };
  };

  const choices: Choice[] = [];
  for (const stop of stops) {
    for (const target of targets) {
      for (let h = 0; h < HORIZON_SPECS.length; h += 1) {
        const choice = evaluate(stop, target, h);
        if (choice) choices.push(choice);
      }
    }
  }
  if (choices.length === 0) return null;

  // A target the price is unlikely to reach inside the window is not a plan, and
  // it would otherwise win the loss-minimising fallback below by never resolving.
  const plausible = choices.filter((choice) => choice.target >= MIN_TARGET_PROBABILITY);

  // Among plans that make money, the best one is the fastest earner, so expected
  // value per hour picks the target, the stop and the holding window together.
  // Once nothing is profitable that rate flips meaning -- a longer window would
  // simply dilute the loss -- so the fallback ranks on expected value itself.
  // When nothing at all is reachable, report the most reachable plan so the row
  // still shows a coherent (and rejected) idea rather than an unhittable target.
  const profitable = plausible.filter((choice) => choice.ev > 0);
  const best =
    profitable.length > 0
      ? profitable.reduce((winner, choice) =>
          choice.evPerHour > winner.evPerHour ? choice : winner,
        )
      : plausible.length > 0
        ? plausible.reduce((winner, choice) => (choice.ev > winner.ev ? choice : winner))
        : choices.reduce((winner, choice) => (choice.target > winner.target ? choice : winner));

  const spec = HORIZON_SPECS[best.horizonIndex];
  const stop = best.stop;

  // Adverse excursion at the 90th percentile, not the mean: leverage has to
  // survive the bad cases inside the window, not the typical one.
  const adverseExcursion = (() => {
    const buckets = new Array<number>(BARRIER_GRID.length + 1).fill(0);
    for (const sample of estimator.samples) {
      const firsts = isLong ? sample.firstDown : sample.firstUp;
      let reached = 0;
      for (let g = 0; g < BARRIER_GRID.length; g += 1) {
        if (firsts[g] <= spec.bars) reached = g + 1;
      }
      buckets[reached] += sample.weight;
    }
    const cutoff = estimator.weightTotal * 0.9;
    let cumulative = 0;
    for (let g = 0; g < buckets.length; g += 1) {
      cumulative += buckets[g];
      if (cumulative >= cutoff) return g === 0 ? null : BARRIER_GRID[g - 1];
    }
    return BARRIER_GRID[BARRIER_GRID.length - 1];
  })();

  const leverage = leverageFor({
    stopPct: stop.pct,
    atrPct: state.atrPct,
    regime,
    fundingRatePct: state.fundingRatePct,
    adverseExcursionPct: adverseExcursion,
  });

  // Same stop, all target levels, at the chosen window: shows why the pick wins.
  const targetOptions: TargetOption[] = targets
    .map((target) => evaluate(stop, target, best.horizonIndex))
    .filter((choice): choice is Choice => choice != null)
    .map((choice) => ({
      pct: choice.targetPct,
      price: state.entryPrice * (1 + ((isLong ? 1 : -1) * choice.targetPct) / 100),
      targetProbability: choice.target * 100,
      stopProbability: choice.stopProbability * 100,
      neitherProbability: choice.neither * 100,
      grossExpectedValuePct: choice.grossEv,
      costPct: choice.cost,
      expectedValuePct: choice.ev,
      rewardRisk: choice.targetPct / stop.pct,
      recommended: choice.targetPct === best.targetPct,
    }));

  const rawFavorable = HORIZON_SPECS.map((horizon) =>
    engine.touch(horizon.levelPct, horizon.bars, true),
  );
  const horizons: HorizonEstimate[] = HORIZON_SPECS.map((horizon, index) => {
    const hours = horizon.minutes / 60;
    const choice = evaluate(stop, { value: best.targetPct, index: best.targetIndex }, index);
    return {
      label: horizon.label,
      minutes: horizon.minutes,
      levelPct: horizon.levelPct,
      probability: clamp(rawFavorable[index] * 100, 0, 100),
      stopProbability: clamp(engine.touch(stop.pct, horizon.bars, false) * 100, 0, 100),
      expectedValuePct: choice?.ev ?? 0,
      expectedValuePerHourPct: choice ? choice.ev / hours : 0,
      basis: engine.basis,
      recommended: index === best.horizonIndex,
    };
  });

  // A longer window cannot lower the chance of having touched the same level.
  for (let i = 1; i < horizons.length; i += 1) {
    if (horizons[i].levelPct === horizons[i - 1].levelPct) {
      horizons[i].probability = Math.max(horizons[i].probability, horizons[i - 1].probability);
    }
    horizons[i].stopProbability = Math.max(
      horizons[i].stopProbability,
      horizons[i - 1].stopProbability,
    );
  }

  const rewardRisk = best.targetPct / stop.pct;
  const chaseRisk = Math.round(
    clamp(
      (state.return2hPct != null && state.atrPct > 0
        ? ((isLong ? state.return2hPct : -state.return2hPct) / state.atrPct) * 22
        : 0) + (state.position96 != null ? (isLong ? state.position96 : 100 - state.position96) * 0.3 : 0),
      0,
      100,
    ),
  );

  const warnings: string[] = [];
  if (leverage.maxSafe <= 1) warnings.push("SL距離が広くレバレッジを上げられません");
  if (state.atrPct >= 2.5) warnings.push("短期ボラティリティが非常に高い銘柄です");
  if (best.cost >= best.grossEv * 0.5 && best.grossEv > 0) {
    warnings.push("手数料・Fundingが期待値の半分以上を占めます");
  }

  const verdict: OpportunityVerdict =
    best.ev <= 0 || rewardRisk < 1
      ? "NO ENTRY"
      : chaseRisk >= 60
        ? "WAIT FOR PULLBACK"
        : // The edge has to clear another round trip, not just break even.
          best.ev >= best.cost && best.target >= 0.35 && confidence >= 45
          ? "ENTER NOW"
          : "GOOD BUT WAIT";

  const starScore =
    clamp(best.evPerHour * 60, -30, 45) +
    clamp(rewardRisk * 8, 0, 24) +
    confidence * 0.2 -
    chaseRisk * 0.15;
  const stars =
    verdict === "NO ENTRY"
      ? 1
      : starScore >= 48
        ? 5
        : starScore >= 36
          ? 4
          : starScore >= 26
            ? 3
            : starScore >= 16
              ? 2
              : 1;

  // Widen the target into a range when the next level up is nearly as good.
  const upper = targetOptions
    .filter((option) => option.pct > best.targetPct && option.expectedValuePct >= best.ev * 0.75)
    .sort((a, b) => a.pct - b.pct)[0];
  const targetRangeLabel = upper
    ? `+${best.targetPct}〜${upper.pct}%`
    : `+${best.targetPct.toFixed(1)}%`;

  const holding: HoldingPlan = (() => {
    const minMinutes = best.horizonIndex === 0 ? 5 : HORIZON_SPECS[best.horizonIndex - 1].minutes;
    const maxMinutes = spec.minutes;
    return { minMinutes, maxMinutes, label: minutesLabel(minMinutes, maxMinutes) };
  })();

  const drivers = engine.drivers(best.targetPct, stop.pct, spec.bars);
  const reasons = [
    `${spec.label}保有・TP +${best.targetPct}% / SL -${stop.pct}% が時間当たり期待値で最良`,
    `SL根拠: ${stop.reason}`,
    ...drivers,
    ...input.tiltReasons.slice(0, drivers.length ? 2 : 4),
  ];

  return {
    direction,
    entryPrice: state.entryPrice,
    verdict,
    stars,
    profitProbability: best.target * 100,
    stopProbability: best.stopProbability * 100,
    expectedValuePct: best.ev,
    expectedValuePerHourPct: best.evPerHour,
    marginRoiPct: best.ev * leverage.recommendedMax,
    rewardRisk,
    stop,
    recommendedTargetPct: best.targetPct,
    recommendedTargetPrice:
      state.entryPrice * (1 + ((isLong ? 1 : -1) * best.targetPct) / 100),
    targetRangeLabel,
    targets: targetOptions,
    horizons,
    leverage,
    holding,
    costPct: best.cost,
    chaseRisk,
    confidence,
    basis: engine.basis,
    reasons,
    warnings,
  };
}

/** Readable Japanese labels for the model's own feature names. */
const FEATURE_LABELS: Record<string, string> = {
  f15_ema20_dist: "15m EMA20との乖離",
  f15_ema50_dist: "15m EMA50との乖離",
  f15_ema200_dist: "15m EMA200との乖離",
  f15_ema20_50: "15m 短期EMA傾き",
  f15_ema50_200: "15m 中期EMA傾き",
  f15_rsi: "15m RSI水準",
  f15_rsi_delta: "15m RSI変化",
  f15_macd_hist: "15m MACDヒストグラム",
  f15_macd_line: "15m MACD",
  f15_adx: "15m ADX(トレンド強度)",
  f15_di_diff: "15m 方向性(+DI/-DI差)",
  f15_atr_regime: "15m ボラティリティ水準",
  f15_bb_width: "15m BB幅",
  f15_percent_b: "15m BB内位置",
  f15_vwap_dist: "15m VWAP乖離",
  f15_volume_z: "15m 出来高z-score",
  f15_volume_ratio: "15m 出来高比",
  f15_structure: "15m 高値安値構造",
  f15_range_pos: "24時間レンジ内位置",
  f15_res_dist: "上値抵抗までの距離",
  f15_sup_dist: "下値支持までの距離",
  f15_ret1: "直近15分リターン",
  f15_ret2: "直近30分リターン",
  f15_ret4: "直近1時間リターン",
  f15_ret8: "直近2時間リターン",
  f15_ret16: "直近4時間リターン",
  f15_cvd_delta4: "1時間CVD",
  f15_cvd_delta16: "4時間CVD",
  f15_cvd_available: "CVD取得可否",
  h1_ema20_dist: "1h EMA20乖離",
  h1_ema20_50: "1h 短期EMA傾き",
  h1_ema50_200: "1h 中期EMA傾き",
  h1_rsi: "1h RSI",
  h1_macd_hist: "1h MACD",
  h1_adx: "1h ADX",
  h1_di_diff: "1h 方向性",
  h1_atr_regime: "1h ボラティリティ",
  h1_percent_b: "1h BB内位置",
  h1_vwap_dist: "1h VWAP乖離",
  h1_range_pos: "1h レンジ内位置",
  h1_ret4: "1h 4本リターン",
  h4_ema20_50: "4h EMA傾き",
  h4_rsi: "4h RSI",
  h4_macd_hist: "4h MACD",
  h4_adx: "4h ADX",
  h4_di_diff: "4h 方向性",
  h4_ret4: "4h リターン",
  btc_ret4: "BTC 1時間リターン",
  btc_ret16: "BTC 4時間リターン",
  btc_ret96: "BTC 24時間リターン",
  btc_rsi: "BTC RSI",
  btc_trend: "BTC トレンド",
  btc_atr_regime: "BTC ボラティリティ",
  corr_btc: "BTCとの相関",
  regime_bull: "Regime: BULL",
  regime_bear: "Regime: BEAR",
  regime_highvol: "Regime: 高ボラ",
  regime_lowvol: "Regime: 低ボラ",
  regime_panic: "Regime: PANIC",
  regime_recovery: "Regime: RECOVERY",
  bar_target_sigma: "TPまでの距離(σ換算)",
  bar_stop_sigma: "SLまでの距離(σ換算)",
  bar_log_horizon: "保有時間",
  bar_target_over_stop: "TP/SL比",
  bar_prior_target: "TP到達の解析近似",
  bar_prior_stop: "SL到達の解析近似",
};

function learnedEngine(predictor: SymbolPredictor): ProbabilityEngine {
  return {
    basis: "LEARNED",
    touch: (pct, bars, favorable) =>
      favorable ? predictor.reach(pct, bars) : predictor.adverseReach(pct, bars),
    pair: (targetPct, stopPct, bars) => predictor.pair(targetPct, stopPct, bars),
    drivers: (targetPct, stopPct, bars) =>
      predictor
        .why(targetPct, stopPct, bars, 5)
        // Barrier geometry always dominates the logit and says nothing about the
        // market, so the "why" list shows only state features.
        .filter((entry) => !entry.name.startsWith("bar_"))
        .slice(0, 4)
        .map(
          (entry) =>
            `${entry.contribution >= 0 ? "+" : "-"} ${FEATURE_LABELS[entry.name] ?? entry.name}`,
        ),
  };
}

export type OpportunityInput = {
  symbol: string;
  display: string;
  venue: CandleVenue;
  candles: Candle[];
  ticker: TickerSnapshot | null;
  derivatives: BulkDerivativeStats | null;
  regime: BtcRegime;
  turnoverUsd: number | null;
  /** Trained model. When absent the historical engine runs instead. */
  model?: TrainedModel | null;
  /** BTC feature context, required for the model's market-regime features. */
  market?: MarketContext | null;
};

export type OpportunityOutcome =
  | { ok: true; row: OpportunityRow }
  | { ok: false; reason: string };

/** Both directions for one symbol. Excluded only when the data cannot support it. */
export function evaluateOpportunity(input: OpportunityInput): OpportunityOutcome {
  const { candles } = input;
  if (candles.length < MIN_CANDLES) {
    return { ok: false, reason: `15m足が${candles.length}本しかなく確率推定に不足` };
  }
  const lastClose = candles[candles.length - 1].close;
  const entryPrice = input.ticker?.last && input.ticker.last > 0 ? input.ticker.last : lastClose;
  if (!(entryPrice > 0)) return { ok: false, reason: "現在価格を取得できません" };

  const atrPct = atrPctOf(candles);
  if (atrPct == null || !(atrPct > 0)) return { ok: false, reason: "ATRを算出できません" };

  const samples = scanFirstTouch(candles, [...HORIZON_BARS]);
  if (samples.length < MIN_SAMPLES) {
    return { ok: false, reason: `類似局面が${samples.length}件しかなく推定不可` };
  }
  const features = stateFeatures(candles);
  const { total: weightTotal, ess } = weightSamples(samples, features);
  if (!(weightTotal > 0)) return { ok: false, reason: "状態の重み付けに失敗" };

  const model = volatilityModel(candles, BAR_MINUTES);
  const lambda = blendWeight(ess);
  const closes = candles.map((candle) => candle.close);
  const ema20 = emaSeries(closes, 20);
  const ema50 = emaSeries(closes, 50);
  const fast = ema20[ema20.length - 1];
  const slow = ema50[ema50.length - 1];
  const trend: "UP" | "DOWN" | "FLAT" =
    fast == null || slow == null
      ? "FLAT"
      : Math.abs(fast - slow) / entryPrice < atrPct / 400
        ? "FLAT"
        : fast > slow
          ? "UP"
          : "DOWN";

  const structure = extremes(candles, 96);
  const position96 =
    structure.high > structure.low
      ? clamp(((entryPrice - structure.low) / (structure.high - structure.low)) * 100, 0, 100)
      : null;

  const fundingRatePct =
    input.derivatives?.fundingRate != null ? input.derivatives.fundingRate * 100 : null;

  const state: MarketState = {
    entryPrice,
    atrPct,
    rsi: rsiWilder(closes),
    trend,
    position96,
    volumeRatio: volumeRatioOf(candles),
    orderFlow: orderFlowDelta(candles, 16),
    return2hPct: returnPct(candles, 8),
    swing: extremes(candles, 24),
    structure,
    fundingRatePct,
    isBtc: input.symbol.startsWith("BTC"),
  };

  // The trained model needs its full causal feature stack; when the symbol has
  // too little history, or no model is published, the historical engine covers
  // the row rather than dropping it.
  const live =
    input.model && candles.length >= MODEL_MIN_CANDLES
      ? (() => {
          try {
            const context = buildSymbolContext(input.symbol, candles);
            return buildLiveFeatures(context, input.market ?? null);
          } catch {
            return null;
          }
        })()
      : null;

  const confidence = live
    ? confidenceScore({
        model: input.model!,
        direction: "LONG",
        barsAvailable: candles.length,
        requiredBars: REQUIRED_BARS,
        turnoverUsd: input.turnoverUsd,
        hasFunding: fundingRatePct != null,
        hasOrderFlow: state.orderFlow != null,
        hasBtcContext: input.market != null,
        regimeStable: input.regime.state !== "RISK_OFF",
        modelDisagreement: 0,
      }).score
    : Math.round(
        clamp(
          Math.min(100, ess * 2.5) * 0.45 +
            Math.min(100, (samples.length / 200) * 100) * 0.2 +
            (fundingRatePct != null ? 100 : 0) * 0.12 +
            (input.derivatives?.openInterestUsd != null ? 100 : 0) * 0.08 +
            (state.orderFlow != null ? 100 : 0) * 0.05 +
            (input.turnoverUsd != null && input.turnoverUsd >= 5_000_000 ? 100 : 40) * 0.1,
          0,
          100,
        ),
      );

  const sides = (["LONG", "SHORT"] as const).map((direction) => {
    const { total: tilt, reasons } = buildTilt(direction, state, input.regime);
    const estimator = { samples, weightTotal, lambda, model, tilt };
    const engine =
      live && input.model
        ? learnedEngine(predictorFor(input.model, direction, live))
        : historicalEngine(estimator, direction === "LONG");
    return evaluateSide({
      direction,
      state,
      estimator,
      engine,
      regime: input.regime,
      confidence,
      tiltReasons: reasons,
    });
  });
  const [long, short] = sides;
  if (!long && !short) return { ok: false, reason: "有効なSL/TP候補を作れません" };

  const notes: string[] = [];
  if (state.orderFlow == null) notes.push("この取引所はTaker出来高を返さないためOrder Flowは未使用");
  if (fundingRatePct == null) notes.push("Funding取得不可");
  if (input.model && !live) {
    notes.push(
      candles.length < MODEL_MIN_CANDLES
        ? `15m足が${candles.length}本で学習モデルの必要本数(${MODEL_MIN_CANDLES})に届かず、履歴ベース推定にフォールバック`
        : "特徴量を生成できず履歴ベース推定にフォールバック",
    );
  }
  if (!input.model) notes.push("学習モデル未公開のため履歴ベース推定を使用");

  const bestDirection: OpportunityDirection | null =
    long && short
      ? long.expectedValuePerHourPct >= short.expectedValuePerHourPct
        ? "LONG"
        : "SHORT"
      : long
        ? "LONG"
        : short
          ? "SHORT"
          : null;

  return {
    ok: true,
    row: {
      symbol: input.symbol,
      display: input.display,
      venue: input.venue,
      lastPrice: entryPrice,
      change24hPct: input.ticker?.change24hPct ?? null,
      turnoverUsd: input.turnoverUsd,
      atrPct,
      rsi: state.rsi,
      volumeRatio: state.volumeRatio,
      fundingRatePct,
      openInterestUsd: input.derivatives?.openInterestUsd ?? null,
      orderFlowDelta: state.orderFlow,
      trend,
      sampleSize: samples.length,
      effectiveSampleSize: Math.round(ess),
      long,
      short,
      bestDirection,
      notes,
    },
  };
}
