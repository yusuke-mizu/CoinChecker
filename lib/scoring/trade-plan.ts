import type { ExpectedEntryAssessment } from "./expected-entry";
import type { Candle, CoreTimeframe } from "@/lib/types/market";
import type { FuturesPositioning, TimeframeIndicators } from "@/lib/types/scoring";
import type { TradePlan } from "@/lib/types/trade-decision";

function clamp(value: number, min = 0, max = 100): number {
  return Math.min(max, Math.max(min, value));
}

function nearest(values: Array<number | null | undefined>, current: number): number | null {
  const valid = values.filter((value): value is number => value != null && value > 0);
  return valid.sort((a, b) => Math.abs(a - current) - Math.abs(b - current))[0] ?? null;
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
  const entryLocation =
    current >= entryZoneLow && current <= entryZoneHigh
      ? "ENTRY NOW / GOOD LOCATION"
      : sign * (current - entryZoneHigh) > 0
        ? "CHASE RISK / WAIT FOR PULLBACK"
        : "WAIT / SETUP DEVELOPING";

  const hardStopPct = clamp(input.hardStopPct ?? 10, 1, 25);
  const hardStop = entryMid * (1 - sign * hardStopPct / 100);
  const structureStop = assessment.structuralStopPrice;
  const structureStopPct = Math.abs((entryMid - structureStop) / entryMid) * 100;
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
  const target1 = entryMid + sign * Math.max(Math.min(modeledTargetDistance * 0.55, riskDistance), atr * 0.4);
  const potentialRiskPct = (riskDistance / entryMid) * 100;
  const potentialRewardPct = (modeledTargetDistance / entryMid) * 100;
  const rewardRisk = modeledTargetDistance / riskDistance;

  const volatilityHigh = assessment.volatilityPct >= 4 || assessment.atrPct >= 4;
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
  const riskTier = highRisk ? "HIGH RISK" : lowRisk ? "LOW RISK" : "MEDIUM RISK";
  const highRiskHighReward = riskTier === "HIGH RISK" && potentialRewardPct >= 5 && rewardRisk >= 2;

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

  const correlationSafety = 100 - Math.abs(assessment.marketContext - 50);
  const compoundingQuality = Math.round(
    clamp(
      assessment.expectedMoveScore * 0.25 +
        clamp(rewardRisk * 30) * 0.2 +
        (100 - assessment.reversalRisk) * 0.2 +
        (100 - clamp(potentialRiskPct * 12)) * 0.15 +
        correlationSafety * 0.05 +
        input.dataQuality * 0.15 -
        (riskTier === "HIGH RISK" ? 10 : 0),
    ),
  );
  const mainRisks = [
    ...(assessment.warnings.slice(0, 2)),
    ...(crowding ? ["OI / Funding crowding"] : []),
    ...(volatilityHigh ? ["高Volatility"] : []),
    ...(structureBeyondHardStop ? ["Structure StopがHard Stop外"] : []),
  ];

  return {
    direction,
    entryZoneLow,
    entryZoneHigh,
    entryLocation,
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
    potentialRewardPct,
    potentialRiskPct,
    rewardRisk,
    riskTier,
    highRiskHighReward,
    overheatScore: assessment.overheatScore,
    oversoldScore: assessment.oversoldScore,
    pressureState,
    compoundingQuality,
    confidence: input.confidence,
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
