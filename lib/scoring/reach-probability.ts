import {
  BARRIER_GRID,
  FEATURE_WARMUP,
  blendWeight,
  clamp,
  enforceMonotonic,
  estimateBasis,
  logBarrier,
  logit,
  modelPairSplit,
  normalCdf,
  scanFirstTouch,
  sigmoid,
  snapToGrid,
  stateFeatures,
  touchProbability,
  volatilityModel,
  weightSamples,
} from "./first-passage";
import type { ExpectedEntryAssessment } from "./expected-entry";
import type { Candle, CoreTimeframe } from "@/lib/types/market";
import type { FuturesPositioning, TimeframeIndicators } from "@/lib/types/scoring";
import type { EntryVerdict, HoldingWindow } from "@/lib/types/trade-decision";
import type {
  EntryGrade,
  ReachAnalysis,
  ReachEstimate,
  TargetCandidate,
  TiltFactor,
} from "@/lib/types/reach";

/** Profit / loss distances shown to the user, in percent of entry price. */
export const REACH_LEVELS = [1, 2, 3, 5, 10] as const;

/** Swing-horizon stops below this are noise, not structure. */
const MIN_STOP_PCT = 0.5;
const MAX_TILT = 0.8;

function holdingWindowFor(targetPct: number, sigmaPerHour: number): HoldingWindow {
  if (!(sigmaPerHour > 0)) return "1-2h";
  // Hours for a random walk to cover the target distance in standard deviations.
  const hours = (targetPct / 100 / sigmaPerHour) ** 2;
  if (hours < 0.25) return "5-15m";
  if (hours < 0.5) return "15-30m";
  if (hours < 1) return "30m-1h";
  if (hours < 2) return "1-2h";
  if (hours < 4) return "2-4h";
  if (hours < 12) return "4-12h";
  return "12-24h";
}

function buildTilt(input: {
  direction: "LONG" | "SHORT";
  assessment: ExpectedEntryAssessment;
  indicators: Partial<Record<CoreTimeframe, TimeframeIndicators>>;
  futures: FuturesPositioning | null;
}): { total: number; factors: TiltFactor[] } {
  const { direction, assessment, indicators, futures } = input;
  const factors: TiltFactor[] = [];
  const push = (label: string, delta: number) => {
    if (Math.abs(delta) >= 0.01) factors.push({ label, deltaLogit: delta });
  };

  const aligned = (["4h", "1h", "15m"] as const).filter((timeframe) => {
    const trend = indicators[timeframe]?.trend;
    return direction === "LONG"
      ? trend === "Bullish" || trend === "Strong Bullish"
      : trend === "Bearish" || trend === "Strong Bearish";
  }).length;
  const opposed = (["4h", "1h", "15m"] as const).filter((timeframe) => {
    const trend = indicators[timeframe]?.trend;
    return direction === "LONG"
      ? trend === "Bearish" || trend === "Strong Bearish"
      : trend === "Bullish" || trend === "Strong Bullish";
  }).length;
  push("Multi-Timeframe Alignment", (aligned - opposed) * 0.12);

  const pressure = direction === "LONG" ? assessment.overheatScore : assessment.oversoldScore;
  if (pressure >= 70) push(direction === "LONG" ? "Overheat" : "Oversold", -0.3);
  else if (pressure <= 35) push("Pressure Neutral", 0.08);

  if (assessment.chasingPenalty >= 55) push("Chase Risk", -0.25);

  const barrier = direction === "LONG" ? assessment.resistancePrice : assessment.supportPrice;
  if (barrier != null && assessment.currentPrice > 0) {
    const distancePct = (Math.abs(barrier - assessment.currentPrice) / assessment.currentPrice) * 100;
    if (distancePct < assessment.atrPct * 0.5) {
      push(direction === "LONG" ? "Resistance直下" : "Support直上", -0.22);
    } else if (distancePct > assessment.atrPct * 2) {
      push("障害まで余裕あり", 0.1);
    }
  }

  const structure = indicators["1h"]?.structure;
  if (structure === (direction === "LONG" ? "HH_HL" : "LH_LL")) push("Market Structure順行", 0.12);
  if (structure === (direction === "LONG" ? "LH_LL" : "HH_HL")) push("Market Structure逆行", -0.15);

  if (futures?.availableFunding && futures.fundingPercentile != null) {
    if (direction === "LONG" && futures.fundingPercentile >= 90) push("Funding過熱(Long混雑)", -0.2);
    if (direction === "LONG" && futures.fundingPercentile <= 10) push("Funding低位", 0.1);
    if (direction === "SHORT" && futures.fundingPercentile <= 10) push("Funding過熱(Short混雑)", -0.2);
    if (direction === "SHORT" && futures.fundingPercentile >= 90) push("Funding高位", 0.1);
  }
  if (futures?.availableOi && futures.oiChange1hPct != null) {
    if (Math.abs(futures.oiChange1hPct) >= 5 && assessment.chasingPenalty >= 40) {
      push("OI急増+価格伸長", -0.15);
    } else if (Math.abs(futures.oiChange1hPct) <= 1.5) {
      push("OI安定", 0.06);
    }
  }

  const volumeRatio = indicators["15m"]?.volumeRatio;
  if (volumeRatio != null) {
    if (volumeRatio >= 1.3) push("Volume回復", 0.1);
    else if (volumeRatio <= 0.7) push("Volume低下", -0.1);
  }

  if (assessment.marketContext >= 70) push("Market Context良好", 0.1);
  else if (assessment.marketContext <= 30) push("Market Context不良", -0.15);

  const total = clamp(
    factors.reduce((sum, factor) => sum + factor.deltaLogit, 0),
    -MAX_TILT,
    MAX_TILT,
  );
  return { total, factors };
}

export type ReachInput = {
  direction: "LONG" | "SHORT";
  assessment: ExpectedEntryAssessment;
  candles: Partial<Record<CoreTimeframe, Candle[]>>;
  indicators: Partial<Record<CoreTimeframe, TimeframeIndicators>>;
  futures: FuturesPositioning | null;
  dataQuality: number;
  hardStopPct?: number;
};

/**
 * Estimates how far price is likely to travel from the current price within a
 * short-swing horizon, for one direction, and picks the TP/SL pair with the best
 * modeled expected value.
 *
 * The probabilities are conditioned estimates from past behaviour plus a
 * volatility model. They are not forecasts of the actual future.
 */
export function analyzeReach(input: ReachInput): ReachAnalysis | null {
  const { direction, assessment, indicators, futures } = input;
  const isLong = direction === "LONG";
  const entryPrice = assessment.currentPrice;
  if (!(entryPrice > 0)) return null;

  const use15m = (input.candles["15m"]?.length ?? 0) >= FEATURE_WARMUP + 40;
  const candles = use15m ? input.candles["15m"]! : input.candles["1h"];
  if (!candles || candles.length < FEATURE_WARMUP + 30) return null;
  const barMinutes = use15m ? 15 : 60;
  const horizonBars = use15m ? 16 : 4;
  const horizonHours = (horizonBars * barMinutes) / 60;

  const samples = scanFirstTouch(candles, [horizonBars]);
  if (samples.length < 20) return null;
  const features = stateFeatures(candles);
  const { total: weightTotal, ess } = weightSamples(samples, features);
  if (!(weightTotal > 0)) return null;
  const model = volatilityModel(candles, barMinutes);
  const sigmaHorizon = model.sigmaBar * Math.sqrt(horizonBars);
  const muHorizon = model.muBar * horizonBars;
  const lambda = blendWeight(ess);
  const basis = estimateBasis(lambda);
  const { total: tilt, factors } = buildTilt({ direction, assessment, indicators, futures });

  // Blended touch probability for each grid distance, favorable and adverse.
  const favorableGrid: number[] = [];
  const adverseGrid: number[] = [];
  for (let g = 0; g < BARRIER_GRID.length; g += 1) {
    let favorableWeighted = 0;
    let adverseWeighted = 0;
    for (const sample of samples) {
      const favorableFirst = isLong ? sample.firstUp[g] : sample.firstDown[g];
      const adverseFirst = isLong ? sample.firstDown[g] : sample.firstUp[g];
      if (Number.isFinite(favorableFirst)) favorableWeighted += sample.weight;
      if (Number.isFinite(adverseFirst)) adverseWeighted += sample.weight;
    }
    const favorableEmpirical = favorableWeighted / weightTotal;
    const adverseEmpirical = adverseWeighted / weightTotal;
    const favorableModel = touchProbability(
      logBarrier(BARRIER_GRID[g], isLong),
      model,
      horizonBars,
      true,
    );
    const adverseModel = touchProbability(
      logBarrier(BARRIER_GRID[g], !isLong),
      model,
      horizonBars,
      false,
    );
    favorableGrid.push(
      sigmoid(logit(lambda * favorableEmpirical + (1 - lambda) * favorableModel) + tilt),
    );
    adverseGrid.push(
      sigmoid(logit(lambda * adverseEmpirical + (1 - lambda) * adverseModel) - tilt * 0.5),
    );
  }
  const favorableSmoothed = enforceMonotonic(favorableGrid);
  const adverseSmoothed = enforceMonotonic(adverseGrid);

  const estimateAt = (pct: number, side: "favorable" | "adverse"): ReachEstimate => {
    const { index } = snapToGrid(pct);
    const source = side === "favorable" ? favorableSmoothed : adverseSmoothed;
    return {
      levelPct: pct,
      probability: clamp(source[index] * 100, 0, 100),
      basis,
    };
  };

  // Stop candidates from structure, ATR multiples and the nearest barrier.
  const hardStopPct = clamp(input.hardStopPct ?? 10, 1, 25);
  const structurePct =
    (Math.abs(entryPrice - assessment.structuralStopPrice) / entryPrice) * 100;
  const protectiveBarrier = isLong ? assessment.supportPrice : assessment.resistancePrice;
  const barrierPct =
    protectiveBarrier != null
      ? (Math.abs(entryPrice - protectiveBarrier) / entryPrice) * 100 + assessment.atrPct * 0.3
      : null;
  const stopCandidates = [
    structurePct,
    assessment.atrPct,
    assessment.atrPct * 1.5,
    assessment.atrPct * 2,
    ...(barrierPct != null ? [barrierPct] : []),
  ]
    .filter((value) => Number.isFinite(value) && value > 0)
    .map((value) => snapToGrid(clamp(value, MIN_STOP_PCT, hardStopPct)))
    .filter(
      (candidate, index, all) =>
        all.findIndex((other) => other.index === candidate.index) === index,
    );
  if (stopCandidates.length === 0) return null;

  const pairProbability = (targetIndex: number, stopIndex: number) => {
    let targetFirst = 0;
    let stopFirst = 0;
    for (const sample of samples) {
      const favorableAt = isLong ? sample.firstUp[targetIndex] : sample.firstDown[targetIndex];
      const adverseAt = isLong ? sample.firstDown[stopIndex] : sample.firstUp[stopIndex];
      if (favorableAt < adverseAt) targetFirst += sample.weight;
      else if (Number.isFinite(adverseAt)) stopFirst += sample.weight;
    }
    const targetEmpirical = targetFirst / weightTotal;
    const stopEmpirical = stopFirst / weightTotal;
    const { target: targetModel, stop: stopModel } = modelPairSplit(
      logBarrier(BARRIER_GRID[targetIndex], isLong),
      logBarrier(BARRIER_GRID[stopIndex], !isLong),
      model,
      horizonBars,
    );

    const target = clamp(
      sigmoid(logit(lambda * targetEmpirical + (1 - lambda) * targetModel) + tilt),
      0,
      1,
    );
    const stop = clamp(
      sigmoid(logit(lambda * stopEmpirical + (1 - lambda) * stopModel) - tilt * 0.5),
      0,
      1,
    );
    const scale = target + stop > 1 ? 1 / (target + stop) : 1;
    return { target: target * scale, stop: stop * scale };
  };

  // Expected close-to-close drift when neither barrier is hit inside the horizon.
  let driftWeighted = 0;
  let favorableEndWeight = 0;
  for (const sample of samples) {
    const directional = isLong ? sample.closeReturnPct[0] : -sample.closeReturnPct[0];
    driftWeighted += sample.weight * directional;
    if (directional > 0) favorableEndWeight += sample.weight;
  }
  const driftPct = driftWeighted / weightTotal;
  const favorableAnyProbability = clamp(
    sigmoid(
      logit(
        lambda * (favorableEndWeight / weightTotal) +
          (1 - lambda) * normalCdf((isLong ? muHorizon : -muHorizon) / sigmaHorizon),
      ) + tilt,
    ) * 100,
    0,
    100,
  );

  const candidates: TargetCandidate[] = REACH_LEVELS.map((level) => {
    const target = snapToGrid(level);
    let best: TargetCandidate | null = null;
    for (const stop of stopCandidates) {
      if (stop.value >= target.value) continue;
      const { target: pTarget, stop: pStop } = pairProbability(target.index, stop.index);
      const pNeither = clamp(1 - pTarget - pStop, 0, 1);
      const expectedValuePct =
        pTarget * target.value - pStop * stop.value + pNeither * clamp(driftPct, -stop.value, target.value);
      const candidate: TargetCandidate = {
        targetPct: target.value,
        targetPrice: entryPrice * (1 + ((isLong ? 1 : -1) * target.value) / 100),
        stopPct: stop.value,
        stopPrice: entryPrice * (1 - ((isLong ? 1 : -1) * stop.value) / 100),
        targetProbability: pTarget * 100,
        stopProbability: pStop * 100,
        neitherProbability: pNeither * 100,
        expectedValuePct,
        rewardRisk: target.value / stop.value,
        recommended: false,
      };
      if (!best || candidate.expectedValuePct > best.expectedValuePct) best = candidate;
    }
    return best;
  }).filter((candidate): candidate is TargetCandidate => candidate != null);

  if (candidates.length === 0) return null;
  const primary = candidates.reduce((best, candidate) =>
    candidate.expectedValuePct > best.expectedValuePct ? candidate : best,
  );
  primary.recommended = true;
  const secondary =
    [...candidates]
      .filter((candidate) => candidate.targetPct > primary.targetPct && candidate.expectedValuePct >= 0)
      .sort((a, b) => b.targetPct - a.targetPct)[0] ??
    candidates.find((candidate) => candidate.targetPct > primary.targetPct) ??
    primary;

  const favorable = REACH_LEVELS.map((level) => estimateAt(level, "favorable"));
  const adverse = REACH_LEVELS.map((level) => estimateAt(level, "adverse"));

  const confidence = Math.round(
    clamp(
      Math.min(100, ess * 2) * 0.4 +
        input.dataQuality * 0.35 +
        (futures?.availableOi ? 100 : 0) * 0.1 +
        (futures?.availableFunding ? 100 : 0) * 0.1 +
        (use15m ? 100 : 40) * 0.05,
      0,
      100,
    ),
  );

  const chaseRisk = Math.round(assessment.chasingPenalty);
  const rewardRisk = primary.rewardRisk;
  const entryTiming: EntryVerdict =
    primary.expectedValuePct <= 0
      ? "NO ENTRY"
      : rewardRisk < 1
        ? "NO ENTRY / POOR R:R"
        : chaseRisk >= 55 || (isLong ? assessment.overheatScore : assessment.oversoldScore) >= 70
          ? "WAIT FOR PULLBACK"
          : assessment.decision === "WAIT_FOR_BREAKOUT"
            ? "WAIT FOR BREAKOUT"
            : primary.targetProbability >= 45 &&
                primary.expectedValuePct >= 0.5 &&
                confidence >= 50
              ? "ENTRY NOW"
              : "WAIT";

  const gradeScore =
    clamp(primary.expectedValuePct * 12, -40, 40) +
    clamp(rewardRisk * 10, 0, 30) +
    confidence * 0.2 -
    chaseRisk * 0.2;
  const entryGrade: EntryGrade =
    primary.expectedValuePct <= 0
      ? "AVOID"
      : gradeScore >= 55
        ? "EXCELLENT"
        : gradeScore >= 40
          ? "GOOD"
          : gradeScore >= 25
            ? "FAIR"
            : "POOR";

  const reasons: string[] = [
    `${horizonHours}時間の到達確率を、類似局面${Math.round(ess)}件相当（全${samples.length}件を状態で重み付け）とボラティリティモデルの合成で推定`,
    lambda >= 0.7
      ? "過去の類似局面が十分にあり、実測寄りの推定です"
      : lambda >= 0.3
        ? "類似局面が限られるため、モデルと合成した推定です"
        : "類似局面が少なく、ボラティリティモデル寄りの推定です",
  ];
  if (factors.length) {
    reasons.push(
      `補正: ${factors
        .slice()
        .sort((a, b) => Math.abs(b.deltaLogit) - Math.abs(a.deltaLogit))
        .slice(0, 4)
        .map((factor) => `${factor.label}${factor.deltaLogit > 0 ? "+" : ""}${factor.deltaLogit.toFixed(2)}`)
        .join(" / ")}`,
    );
  }

  return {
    direction,
    entryPrice,
    horizonHours,
    barTimeframe: use15m ? "15m" : "1h",
    sampleSize: samples.length,
    effectiveSampleSize: Math.round(ess),
    confidence,
    favorable,
    adverse,
    favorableAnyProbability,
    adverseAnyProbability: 100 - favorableAnyProbability,
    expectedDriftPct: driftPct,
    volatilityPerHorizonPct: sigmaHorizon * 100,
    candidates,
    recommendedStopPct: primary.stopPct,
    recommendedStopPrice: primary.stopPrice,
    recommendedTarget1Pct: primary.targetPct,
    recommendedTarget1Price: primary.targetPrice,
    recommendedTarget2Pct: secondary.targetPct,
    recommendedTarget2Price: secondary.targetPrice,
    expectedValuePct: primary.expectedValuePct,
    rewardRisk,
    holdingWindow: holdingWindowFor(primary.targetPct, model.sigmaPerHour),
    entryTiming,
    entryGrade,
    chaseRisk,
    tiltFactors: factors,
    reasons,
  };
}
