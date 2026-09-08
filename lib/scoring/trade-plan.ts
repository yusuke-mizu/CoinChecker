import { atr as atrOf } from "./expected-entry";
import type { ExpectedEntryAssessment } from "./expected-entry";
import type { Candle, CoreTimeframe } from "@/lib/types/market";
import type { FuturesPositioning, TimeframeIndicators } from "@/lib/types/scoring";
import type {
  EntryVerdict,
  HoldingWindow,
  LeverageGuidance,
  TradeLevels,
  TradePlan,
  TradeRiskTier,
} from "@/lib/types/trade-decision";

/** Loss on margin we are willing to accept if the recommended stop is reached. */
const TARGET_MARGIN_LOSS_PCT = 8;
const MAX_LEVERAGE = 20;

function clamp(value: number, min = 0, max = 100): number {
  return Math.min(max, Math.max(min, value));
}

function nearest(values: Array<number | null | undefined>, current: number): number | null {
  const valid = values.filter((value): value is number => value != null && value > 0);
  return valid.sort((a, b) => Math.abs(a - current) - Math.abs(b - current))[0] ?? null;
}

function atrPercent(candles: Candle[] | undefined, reference: number): number | null {
  if (!candles || candles.length < 20 || !(reference > 0)) return null;
  const value = atrOf(candles);
  return value == null ? null : (value / reference) * 100;
}

function breakoutEvidence(
  direction: "LONG" | "SHORT",
  candles: Candle[],
  atr: number,
  volumeRatio: number | null,
  futures: FuturesPositioning | null,
): { level: number | null; crossed: boolean; retested: boolean; oiConfirmed: boolean } {
  if (candles.length < 24) {
    return { level: null, crossed: false, retested: false, oiConfirmed: false };
  }
  const recent = candles.slice(-8);
  const history = candles.slice(-48, -8);
  const level =
    direction === "LONG"
      ? Math.max(...history.map((row) => row.high))
      : Math.min(...history.map((row) => row.low));
  const sign = direction === "LONG" ? 1 : -1;
  const crossingIndex = recent.findIndex((row, index) => {
    const previous = recent[index - 1];
    if (!previous) return false;
    return sign * (previous.close - level) <= 0 && sign * (row.close - level) > atr * 0.1;
  });
  const crossed = crossingIndex >= 0 && (volumeRatio ?? 0) >= 1.2;
  const retested =
    crossed &&
    recent.slice(crossingIndex + 1).some((row) => {
      const touched =
        direction === "LONG" ? row.low <= level + atr * 0.2 : row.high >= level - atr * 0.2;
      const held = sign * (row.close - level) >= 0;
      return touched && held;
    });
  const oiConfirmed = !futures?.availableOi || (futures.oiChange15mPct ?? 0) >= 1;
  return { level, crossed: crossed && oiConfirmed, retested, oiConfirmed };
}

function holdingWindowFor(target1Pct: number, atrPct1h: number | null): HoldingWindow {
  if (atrPct1h == null || atrPct1h <= 0) return "1-2h";
  // Assume roughly 0.6 ATR of favorable travel per hour rather than a full ATR.
  const hours = target1Pct / (atrPct1h * 0.6);
  if (hours < 0.25) return "5-15m";
  if (hours < 0.5) return "15-30m";
  if (hours < 1) return "30m-1h";
  if (hours < 2) return "1-2h";
  if (hours < 4) return "2-4h";
  if (hours < 12) return "4-12h";
  return "12-24h";
}

function leverageFor(input: {
  stopLossPct: number;
  target1Pct: number;
  riskTier: TradeRiskTier;
  confidenceScore: number;
  atrPct: number;
}): LeverageGuidance {
  const tierCap =
    input.riskTier === "EXTREME RISK"
      ? 3
      : input.riskTier === "HIGH RISK"
        ? 6
        : input.riskTier === "MEDIUM RISK"
          ? 12
          : MAX_LEVERAGE;
  const volatilityCap = input.atrPct >= 5 ? 3 : input.atrPct >= 3 ? 6 : MAX_LEVERAGE;
  const confidenceFactor = 0.5 + (input.confidenceScore / 100) * 0.5;
  const raw = (TARGET_MARGIN_LOSS_PCT / Math.max(input.stopLossPct, 0.05)) * confidenceFactor;
  const max = Math.floor(Math.min(raw, tierCap, volatilityCap, MAX_LEVERAGE));
  if (max < 1) {
    return {
      min: 1,
      max: 1,
      marginLossAtStopPct: input.stopLossPct,
      marginRoiAtTarget1Pct: input.target1Pct,
      warning:
        "LEVERAGE TOO HIGH: 想定変動が大きく、1xでも証拠金リスクが目標を超えます。",
    };
  }
  const min = Math.max(1, Math.floor(max * 0.6));
  return {
    min,
    max,
    marginLossAtStopPct: input.stopLossPct * max,
    marginRoiAtTarget1Pct: input.target1Pct * max,
    warning:
      input.atrPct >= 5
        ? "Extreme Volatility: 推奨Leverageを大幅に制限しています。"
        : null,
  };
}

export function buildTradePlan(input: {
  assessment: ExpectedEntryAssessment;
  candles: Partial<Record<CoreTimeframe, Candle[]>>;
  indicators: Partial<Record<CoreTimeframe, TimeframeIndicators>>;
  futures: FuturesPositioning | null;
  dataQuality: number;
  confidence: "HIGH" | "MEDIUM" | "LOW";
  hardStopPct?: number;
}): TradePlan {
  const { assessment } = input;
  const direction = assessment.direction;
  const sign = direction === "LONG" ? 1 : -1;
  const current = assessment.currentPrice;
  const atr = Math.max((assessment.atrPct / 100) * current, current * 0.001);
  const indicator1h = input.indicators["1h"];
  const preferredStructure =
    direction === "LONG" ? assessment.supportPrice : assessment.resistancePrice;
  const anchor =
    nearest([indicator1h?.ema20, assessment.vwap, preferredStructure], current) ?? current;
  const boundedAnchor =
    Math.abs(anchor - current) <= atr * 1.5 ? anchor : current - sign * atr * 0.45;
  const zoneHalfWidth = atr * 0.25;
  const entryZoneLow = boundedAnchor - zoneHalfWidth;
  const entryZoneHigh = boundedAnchor + zoneHalfWidth;
  const entryMid = (entryZoneLow + entryZoneHigh) / 2;
  const inZone = current >= entryZoneLow && current <= entryZoneHigh;
  const entryLocation = inZone
    ? "ENTRY NOW / GOOD LOCATION"
    : sign * (current - entryZoneHigh) > 0
      ? "CHASE RISK / WAIT FOR PULLBACK"
      : "WAIT / SETUP DEVELOPING";

  const hardStopPct = clamp(input.hardStopPct ?? 10, 1, 25);
  const hardStop = entryMid * (1 - sign * hardStopPct / 100);
  const structureStop = assessment.structuralStopPrice;
  const structureStopPct = Math.abs((entryMid - structureStop) / entryMid) * 100;
  // The structure stop is the recommendation; the hard stop only caps maximum loss.
  const structureBeyondHardStop = sign * (structureStop - hardStop) < 0;
  const invalidationLevel = structureBeyondHardStop ? hardStop : structureStop;
  const riskDistance = Math.max(Math.abs(entryMid - invalidationLevel), atr * 0.5);

  const breakout = breakoutEvidence(
    direction,
    input.candles["15m"] ?? input.candles["1h"] ?? [],
    atr,
    input.indicators["15m"]?.volumeRatio ?? null,
    input.futures,
  );
  const breakoutLevel =
    breakout.level ??
    (direction === "LONG" ? assessment.resistancePrice : assessment.supportPrice);
  const isChasing =
    (direction === "LONG" ? assessment.overheatScore : assessment.oversoldScore) >= 70 ||
    assessment.chasingPenalty >= 55;
  const breakoutStatus =
    breakout.crossed && isChasing
      ? "CONFIRMED_CHASING_RISK"
      : breakout.retested
        ? "CONFIRMED_RETEST"
        : breakout.crossed
          ? "CONFIRMED"
          : breakoutLevel != null
            ? "WAITING"
            : "NOT_APPLICABLE";

  const modeledTargetDistance = Math.max(
    Math.abs(assessment.targetPrice - entryMid),
    atr * 0.5,
  );
  const target2 = entryMid + sign * modeledTargetDistance;
  const target1 =
    entryMid + sign * Math.max(Math.min(modeledTargetDistance * 0.55, riskDistance), atr * 0.4);
  const potentialRiskPct = (riskDistance / entryMid) * 100;
  const potentialRewardPct = (modeledTargetDistance / entryMid) * 100;
  const rewardRisk = modeledTargetDistance / riskDistance;

  const expectedMove15mPct = atrPercent(input.candles["15m"], current);
  const expectedMove1hPct = atrPercent(input.candles["1h"], current) ?? assessment.atrPct;
  const expectedMove4hPct = atrPercent(input.candles["4h"], current);

  const volatilityHigh = assessment.volatilityPct >= 4 || assessment.atrPct >= 4;
  const volatilityExtreme = assessment.volatilityPct >= 8 || assessment.atrPct >= 6;
  const crowding =
    (input.futures?.fundingPercentile ?? 50) >= 90 ||
    (input.futures?.fundingPercentile ?? 50) <= 10 ||
    Math.abs(input.futures?.oiChange1hPct ?? 0) >= 5;
  const highRisk =
    volatilityHigh ||
    crowding ||
    assessment.reversalRisk >= 65 ||
    input.dataQuality < 50 ||
    structureBeyondHardStop;
  const lowRisk =
    !highRisk &&
    rewardRisk >= 2 &&
    assessment.reversalRisk <= 35 &&
    assessment.marketContext >= 60 &&
    input.dataQuality >= 70;
  const riskTier: TradeRiskTier =
    volatilityExtreme || input.dataQuality < 35
      ? "EXTREME RISK"
      : highRisk
        ? "HIGH RISK"
        : lowRisk
          ? "LOW RISK"
          : "MEDIUM RISK";
  const highRiskHighReward =
    (riskTier === "HIGH RISK" || riskTier === "EXTREME RISK") &&
    potentialRewardPct >= 5 &&
    rewardRisk >= 2;

  const trend4h = input.indicators["4h"]?.trend ?? "Neutral";
  const oversoldReversal =
    assessment.oversoldScore >= 70 &&
    ((direction === "LONG" && assessment.reversalRisk <= 45) ||
      (direction === "SHORT" && assessment.reversalRisk >= 55));
  const continuingDowntrend =
    assessment.oversoldScore >= 70 &&
    (trend4h === "Bearish" || trend4h === "Strong Bearish") &&
    assessment.reversalRisk > 45;
  const healthyPullback =
    assessment.entryType === "PULLBACK" &&
    assessment.chasingPenalty < 40 &&
    assessment.timingScore >= 60;
  const pressureState =
    assessment.overheatScore >= 70
      ? "OVERHEATED"
      : oversoldReversal
        ? "OVERSOLD + REVERSAL"
        : continuingDowntrend
          ? "OVERSOLD + CONTINUING DOWNTREND"
          : healthyPullback
            ? "HEALTHY PULLBACK"
            : "NEUTRAL";

  const timeframeAgreement = (["4h", "1h", "15m"] as const).filter((timeframe) => {
    const trend = input.indicators[timeframe]?.trend;
    return direction === "LONG"
      ? trend === "Bullish" || trend === "Strong Bullish"
      : trend === "Bearish" || trend === "Strong Bearish";
  }).length;
  const confidenceScore = Math.round(
    clamp(
      input.dataQuality * 0.35 +
        (timeframeAgreement / 3) * 100 * 0.25 +
        assessment.timingScore * 0.15 +
        assessment.marketContext * 0.1 +
        (input.futures?.availableOi ? 50 : 0) * 0.05 +
        (input.futures?.availableFunding ? 50 : 0) * 0.05 +
        (100 - assessment.reversalRisk) * 0.05,
    ),
  );

  // Recommended execution levels, anchored to where entry is actually possible.
  const entryReference = inZone ? current : entryMid;
  const stopLoss = invalidationLevel;
  const stopLossPct = Math.abs((entryReference - stopLoss) / entryReference) * 100;
  const target1Pct = Math.abs((target1 - entryReference) / entryReference) * 100;
  const target2Pct = Math.abs((target2 - entryReference) / entryReference) * 100;
  const levels: TradeLevels = {
    entryReference,
    stopLoss,
    stopLossPct,
    target1,
    target1Pct,
    target2,
    target2Pct,
    rewardRisk: target1Pct / Math.max(stopLossPct, 0.01),
  };

  const leverage = leverageFor({
    stopLossPct,
    target1Pct,
    riskTier,
    confidenceScore,
    atrPct: assessment.atrPct,
  });
  const holdingWindow = holdingWindowFor(target1Pct, expectedMove1hPct);

  const estimatedTargetProbability = Math.min(
    0.65,
    Math.max(
      0.15,
      0.3 +
        (confidenceScore - 50) / 500 +
        Math.min(rewardRisk, 3) / 30 -
        assessment.reversalRisk / 400 -
        assessment.chasingPenalty / 500,
    ),
  );
  const estimatedExpectedValuePct =
    estimatedTargetProbability * target1Pct -
    (1 - estimatedTargetProbability) * stopLossPct;

  const poorRewardRisk = levels.rewardRisk < 1;
  const entryVerdict: EntryVerdict = structureBeyondHardStop
    ? "NO ENTRY"
    : poorRewardRisk
      ? "NO ENTRY / POOR R:R"
      : entryLocation === "CHASE RISK / WAIT FOR PULLBACK"
        ? "WAIT FOR PULLBACK"
        : breakoutStatus === "WAITING" && assessment.decision === "WAIT_FOR_BREAKOUT"
          ? "WAIT FOR BREAKOUT"
          : inZone &&
              assessment.total >= 80 &&
              rewardRisk >= 2 &&
              confidenceScore >= 60 &&
              assessment.reversalRisk <= 45
            ? "ENTRY NOW"
            : assessment.total >= 65
              ? "WAIT"
              : "NO ENTRY";

  const correlationSafety = 100 - Math.abs(assessment.marketContext - 50);
  const compoundingQuality = Math.round(
    clamp(
      assessment.expectedMoveScore * 0.2 +
        clamp(levels.rewardRisk * 30) * 0.2 +
        (100 - assessment.reversalRisk) * 0.15 +
        (100 - clamp(leverage.marginLossAtStopPct * 5)) * 0.15 +
        correlationSafety * 0.05 +
        confidenceScore * 0.15 +
        input.dataQuality * 0.1 -
        (riskTier === "EXTREME RISK" ? 20 : riskTier === "HIGH RISK" ? 10 : 0),
    ),
  );

  const mainRisks = [
    ...assessment.warnings.slice(0, 2),
    ...(crowding ? ["OI / Funding crowding"] : []),
    ...(volatilityExtreme ? ["Extreme Volatility"] : volatilityHigh ? ["高Volatility"] : []),
    ...(structureBeyondHardStop ? ["Structure StopがHard Stop外"] : []),
  ];

  return {
    direction,
    entryZoneLow,
    entryZoneHigh,
    entryLocation,
    entryVerdict,
    structureStop,
    structureStopPct,
    hardStop,
    hardStopPct,
    invalidationLevel,
    breakoutLevel,
    breakoutStatus,
    breakoutRequirements: [
      "Resistance/SupportをCandle closeで突破",
      "Volume ratio 1.2以上",
      input.futures?.availableOi ? "OI増加を確認" : "OI unavailable: Confidenceを下げる",
      "過剰乖離時はRetestを待つ",
    ],
    target1,
    target2,
    levels,
    potentialRewardPct,
    potentialRiskPct,
    rewardRisk,
    expectedMove15mPct,
    expectedMove1hPct,
    expectedMove4hPct,
    leverage,
    holdingWindow,
    estimatedExpectedValuePct,
    estimatedTargetProbability,
    riskTier,
    highRiskHighReward,
    overheatScore: assessment.overheatScore,
    oversoldScore: assessment.oversoldScore,
    pressureState,
    compoundingQuality,
    confidence: input.confidence,
    confidenceScore,
    structureBeyondHardStop,
    thesis: {
      whyTrade: `${direction} Trend ${assessment.trendQuality} / Expected Move ${assessment.expectedMoveScore}`,
      whyNow:
        entryLocation === "ENTRY NOW / GOOD LOCATION"
          ? "現在価格は算出Entry Zone内です。"
          : entryLocation === "CHASE RISK / WAIT FOR PULLBACK"
            ? "Setupはありますが、現在価格はEntry Zoneを行き過ぎています。"
            : "Entry Zone到達またはSetup改善を待つ局面です。",
      mustHappen:
        breakoutLevel == null
          ? "Entry Zoneを維持し、MomentumとVolumeの改善が必要です。"
          : `${breakoutLevel.toPrecision(7)}を終値・Volume${input.futures?.availableOi ? "・OI" : ""}で確認する必要があります。`,
      invalidation: `${invalidationLevel.toPrecision(7)}を明確に抜けると現在のThesisは無効です。`,
      takeProfit: `TP1 ${target1.toPrecision(7)} / TP2 ${target2.toPrecision(7)}。到達は保証されません。`,
      mainRisk: mainRisks.join(" / ") || "市場環境と価格構造の急変",
    },
  };
}
