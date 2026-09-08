import { describe, expect, it } from "vitest";
import { buildTradePlan } from "./trade-plan";
import type { ExpectedEntryAssessment } from "./expected-entry";
import type { Candle } from "@/lib/types/market";

const assessment: ExpectedEntryAssessment = {
  direction: "LONG",
  horizon: "4h",
  total: 86,
  trendQuality: 82,
  timingScore: 84,
  expectedMoveScore: 80,
  reversalRisk: 20,
  marketContext: 80,
  chasingPenalty: 18,
  chasingPenaltyPoints: 5,
  overheatScore: 35,
  oversoldScore: 30,
  currentPrice: 100,
  targetPrice: 106,
  structuralStopPrice: 97,
  userMaxStopPrice: 90,
  potentialRewardPct: 6,
  potentialRiskPct: 3,
  rewardRisk: 2,
  expectedValueProxy: 3,
  atrPct: 2,
  volatilityPct: 1.5,
  supportPrice: 97.5,
  resistancePrice: 106,
  vwap: 100,
  bollingerPosition: 0.55,
  entryType: "PULLBACK",
  decision: "ENTRY_NOW",
  lateEntryWarning: false,
  items: [],
  why: [],
  warnings: [],
};

const candles: Candle[] = Array.from({ length: 50 }, (_, index) => ({
  openTime: index * 900_000,
  open: 100,
  high: 101,
  low: 99,
  close: 100,
  volume: 100,
  closeTime: (index + 1) * 900_000 - 1,
}));

describe("buildTradePlan", () => {
  it("separates entry zone, structure stop, hard stop and staged targets", () => {
    const plan = buildTradePlan({
      assessment,
      candles: { "1h": candles, "15m": candles },
      indicators: {},
      futures: null,
      dataQuality: 90,
      confidence: "HIGH",
      hardStopPct: 10,
    });

    expect(plan.entryZoneLow).toBeLessThan(100);
    expect(plan.entryZoneHigh).toBeGreaterThan(100);
    expect(plan.entryLocation).toBe("ENTRY NOW / GOOD LOCATION");
    expect(plan.structureStop).toBe(97);
    expect(plan.hardStop).toBe(90);
    expect(plan.invalidationLevel).toBe(97);
    expect(plan.target1).toBeLessThan(plan.target2);
    expect(plan.rewardRisk).toBeGreaterThanOrEqual(2);
    expect(plan.riskTier).toBe("LOW RISK");
  });

  it("does not treat extreme momentum as a safe entry", () => {
    const plan = buildTradePlan({
      assessment: {
        ...assessment,
        chasingPenalty: 80,
        overheatScore: 90,
        structuralStopPrice: 85,
      },
      candles: { "1h": candles, "15m": candles },
      indicators: {},
      futures: null,
      dataQuality: 90,
      confidence: "HIGH",
      hardStopPct: 10,
    });

    expect(plan.pressureState).toBe("OVERHEATED");
    expect(plan.structureBeyondHardStop).toBe(true);
    expect(plan.riskTier).toBe("HIGH RISK");
    expect(plan.entryVerdict).toBe("NO ENTRY");
  });

  it("derives recommended stop and staged targets from the executable entry", () => {
    const plan = buildTradePlan({
      assessment,
      candles: { "1h": candles, "15m": candles },
      indicators: {},
      futures: null,
      dataQuality: 90,
      confidence: "HIGH",
      hardStopPct: 10,
    });

    expect(plan.levels.stopLoss).toBe(plan.invalidationLevel);
    // Structure stop drives the recommendation; hard stop only caps the loss.
    expect(plan.levels.stopLossPct).toBeLessThan(plan.hardStopPct);
    expect(plan.levels.target1Pct).toBeLessThan(plan.levels.target2Pct);
    expect(plan.levels.rewardRisk).toBeCloseTo(
      plan.levels.target1Pct / plan.levels.stopLossPct,
      6,
    );
  });

  it("scales leverage down as volatility rises", () => {
    const calm = buildTradePlan({
      assessment,
      candles: { "1h": candles, "15m": candles },
      indicators: {},
      futures: null,
      dataQuality: 90,
      confidence: "HIGH",
    });
    const volatile = buildTradePlan({
      assessment: { ...assessment, atrPct: 7, volatilityPct: 9, structuralStopPrice: 93 },
      candles: { "1h": candles, "15m": candles },
      indicators: {},
      futures: null,
      dataQuality: 90,
      confidence: "HIGH",
    });

    expect(volatile.riskTier).toBe("EXTREME RISK");
    expect(volatile.leverage.max).toBeLessThan(calm.leverage.max);
    expect(calm.leverage.marginLossAtStopPct).toBeLessThanOrEqual(12);
  });

  it("rejects setups whose first target does not clear the stop", () => {
    const plan = buildTradePlan({
      assessment: {
        ...assessment,
        targetPrice: 100.3,
        structuralStopPrice: 94,
        potentialRewardPct: 0.3,
      },
      candles: { "1h": candles, "15m": candles },
      indicators: {},
      futures: null,
      dataQuality: 90,
      confidence: "HIGH",
    });

    expect(plan.levels.rewardRisk).toBeLessThan(1);
    expect(plan.entryVerdict).toBe("NO ENTRY / POOR R:R");
  });

  it("recommends a shorter hold when expected move is reached quickly", () => {
    const fast = buildTradePlan({
      assessment: { ...assessment, atrPct: 3 },
      candles: { "1h": candles, "15m": candles },
      indicators: {},
      futures: null,
      dataQuality: 90,
      confidence: "HIGH",
    });
    const slow = buildTradePlan({
      assessment: { ...assessment, atrPct: 0.3 },
      candles: { "1h": candles, "15m": candles },
      indicators: {},
      futures: null,
      dataQuality: 90,
      confidence: "HIGH",
    });

    const order = ["5-15m", "15-30m", "30m-1h", "1-2h", "2-4h", "4-12h", "12-24h"];
    expect(order.indexOf(fast.holdingWindow)).toBeLessThanOrEqual(
      order.indexOf(slow.holdingWindow),
    );
  });
});
