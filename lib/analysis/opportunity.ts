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
import type { BulkDerivativeStats } from "@/lib/market-data/bulk-derivatives";
import type { Candle, TickerSnapshot } from "@/lib/types/market";
import type { CandleVenue } from "@/lib/types/venue";
import type {
  BtcRegime,
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
export const CANDLE_LIMIT = 300;
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
  let ceiling = Math.max(1, Math.min(20, liquidationCap));
  if (liquidationCap < 20) caps.push(`Liquidation余裕から上限${liquidationCap}x`);

  const volatilityCap = atrPct >= 2.5 ? 3 : atrPct >= 1.5 ? 5 : atrPct >= 0.8 ? 10 : 20;
  if (volatilityCap < ceiling) {
    ceiling = volatilityCap;
    caps.push(`高ボラティリティ(ATR ${atrPct.toFixed(2)}%)で上限${volatilityCap}x`);
  }

  if (input.adverseExcursionPct != null && input.adverseExcursionPct > 0) {
    const excursionCap = Math.floor(100 / (input.adverseExcursionPct * 1.2 + MAINTENANCE_MARGIN_PCT));
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
    const raw = budget / stopPct;
    const max = clamp(Math.floor(Math.min(raw, ceiling)), 1, 25);
    const min = clamp(Math.floor(Math.min(raw * 0.65, max)), 1, max);
    return [min, max];
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
  regime: BtcRegime;
  confidence: number;
  tiltReasons: string[];
}): OpportunitySide | null {
  const { direction, state, estimator, regime, confidence } = input;
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
    const { target: pTarget, stop: pStop } = pairAt(
      estimator,
      target.index,
      snapToGrid(stop.pct).index,
      spec.bars,
      isLong,
    );
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

  // Expected value per hour is the objective: it picks the target, the stop and
  // the holding window together, and costs stop the shortest window from always
  // winning on rate alone.
  const best = choices.reduce((winner, choice) =>
    choice.evPerHour > winner.evPerHour ? choice : winner,
  );

  const spec = HORIZON_SPECS[best.horizonIndex];
  const stop = best.stop;

  const adverseExcursion = (() => {
    // Weighted mean of the worst adverse excursion seen inside the window.
    let weighted = 0;
    for (const sample of estimator.samples) {
      const firsts = isLong ? sample.firstDown : sample.firstUp;
      let touched = 0;
      for (let g = 0; g < BARRIER_GRID.length; g += 1) {
        if (firsts[g] <= spec.bars) touched = BARRIER_GRID[g];
      }
      weighted += sample.weight * touched;
    }
    const mean = weighted / estimator.weightTotal;
    return mean > 0 ? mean : null;
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

  const stopGridIndex = snapToGrid(stop.pct).index;
  const rawFavorable = HORIZON_SPECS.map((horizon) =>
    touchAt(estimator, snapToGrid(horizon.levelPct).index, horizon.bars, isLong, true),
  );
  const horizons: HorizonEstimate[] = HORIZON_SPECS.map((horizon, index) => {
    const hours = horizon.minutes / 60;
    const choice = evaluate(stop, { value: best.targetPct, index: best.targetIndex }, index);
    return {
      label: horizon.label,
      minutes: horizon.minutes,
      levelPct: horizon.levelPct,
      probability: clamp(rawFavorable[index] * 100, 0, 100),
      stopProbability: clamp(
        touchAt(estimator, stopGridIndex, horizon.bars, isLong, false) * 100,
        0,
        100,
      ),
      expectedValuePct: choice?.ev ?? 0,
      expectedValuePerHourPct: choice ? choice.ev / hours : 0,
      basis: estimateBasis(estimator.lambda),
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
        : best.ev >= 0.2 && best.target >= 0.4 && confidence >= 45
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

  const reasons = [
    `${spec.label}保有・TP +${best.targetPct}% / SL -${stop.pct}% が時間当たり期待値で最良`,
    `SL根拠: ${stop.reason}`,
    ...input.tiltReasons.slice(0, 4),
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
    basis: estimateBasis(estimator.lambda),
    reasons,
    warnings,
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

  const confidence = Math.round(
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
    return evaluateSide({
      direction,
      state,
      estimator: { samples, weightTotal, lambda, model, tilt },
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
