import { describe, expect, it } from "vitest";
import { REACH_LEVELS, analyzeReach } from "./reach-probability";
import type { ExpectedEntryAssessment } from "./expected-entry";
import type { Candle } from "@/lib/types/market";

function walk(options: {
  count?: number;
  volatility: number;
  drift: number;
  seed?: number;
  start?: number;
}): Candle[] {
  const count = options.count ?? 320;
  let state = (options.seed ?? 7) >>> 0;
  const random = () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
  let price = options.start ?? 100;
  const candles: Candle[] = [];
  for (let i = 0; i < count; i += 1) {
    const shock = (random() - 0.5) * 2 * options.volatility;
    const open = price;
    price = Math.max(0.01, price * (1 + options.drift + shock));
    const high = Math.max(open, price) * (1 + options.volatility * 0.4);
    const low = Math.min(open, price) * (1 - options.volatility * 0.4);
    const openTime = i * 900_000;
    candles.push({
      openTime,
      open,
      high,
      low,
      close: price,
      volume: 1_000 + random() * 200,
      closeTime: openTime + 899_999,
    });
  }
  return candles;
}

function assessmentFor(candles: Candle[], overrides: Partial<ExpectedEntryAssessment> = {}) {
  const price = candles[candles.length - 1].close;
  const base: ExpectedEntryAssessment = {
    direction: "LONG",
    horizon: "4h",
    total: 78,
    trendQuality: 70,
    timingScore: 70,
    expectedMoveScore: 70,
    reversalRisk: 25,
    marketContext: 60,
    chasingPenalty: 20,
    chasingPenaltyPoints: 5,
    overheatScore: 35,
    oversoldScore: 30,
    currentPrice: price,
    targetPrice: price * 1.03,
    structuralStopPrice: price * 0.985,
    userMaxStopPrice: price * 0.9,
    potentialRewardPct: 3,
    potentialRiskPct: 1.5,
    rewardRisk: 2,
    expectedValueProxy: 1.5,
    atrPct: 1.2,
    volatilityPct: 1.2,
    supportPrice: price * 0.98,
    resistancePrice: price * 1.04,
    vwap: price,
    bollingerPosition: 0.5,
    entryType: "PULLBACK",
    decision: "ENTRY_NOW",
    lateEntryWarning: false,
    items: [],
    why: [],
    warnings: [],
  };
  return { ...base, ...overrides };
}

function analyze(
  candles: Candle[],
  overrides: Partial<ExpectedEntryAssessment> = {},
  direction: "LONG" | "SHORT" = "LONG",
) {
  return analyzeReach({
    direction,
    assessment: assessmentFor(candles, { ...overrides, direction }),
    candles: { "15m": candles },
    indicators: {},
    futures: null,
    dataQuality: 80,
    hardStopPct: 10,
  });
}

describe("analyzeReach", () => {
  const candles = walk({ volatility: 0.006, drift: 0 });

  it("returns a probability for every displayed level", () => {
    const result = analyze(candles);
    expect(result).not.toBeNull();
    expect(result!.favorable.map((estimate) => estimate.levelPct)).toEqual([...REACH_LEVELS]);
    expect(result!.adverse.map((estimate) => estimate.levelPct)).toEqual([...REACH_LEVELS]);
    for (const estimate of [...result!.favorable, ...result!.adverse]) {
      expect(estimate.probability).toBeGreaterThanOrEqual(0);
      expect(estimate.probability).toBeLessThanOrEqual(100);
    }
  });

  it("never reports a larger move as more likely than a smaller one", () => {
    const result = analyze(candles)!;
    for (const side of [result.favorable, result.adverse]) {
      for (let i = 1; i < side.length; i += 1) {
        expect(side[i].probability).toBeLessThanOrEqual(side[i - 1].probability + 1e-9);
      }
    }
  });

  it("raises reach probabilities when volatility is higher", () => {
    const calm = analyze(walk({ volatility: 0.002, drift: 0, seed: 11 }))!;
    const wild = analyze(walk({ volatility: 0.02, drift: 0, seed: 11 }))!;
    const at5 = (result: typeof calm) =>
      result.favorable.find((estimate) => estimate.levelPct === 5)!.probability;
    expect(at5(wild)).toBeGreaterThan(at5(calm));
  });

  it("keeps the recommended stop inside the user hard stop", () => {
    const result = analyze(candles)!;
    expect(result.recommendedStopPct).toBeGreaterThan(0);
    expect(result.recommendedStopPct).toBeLessThanOrEqual(10);
    expect(result.recommendedTarget1Pct).toBeGreaterThan(result.recommendedStopPct);
  });

  it("recommends the target with the best modeled expected value", () => {
    const result = analyze(candles)!;
    const recommended = result.candidates.filter((candidate) => candidate.recommended);
    expect(recommended).toHaveLength(1);
    for (const candidate of result.candidates) {
      expect(candidate.expectedValuePct).toBeLessThanOrEqual(
        recommended[0].expectedValuePct + 1e-9,
      );
    }
    expect(result.recommendedTarget1Pct).toBe(recommended[0].targetPct);
  });

  it("keeps first-touch probabilities coherent for each candidate", () => {
    const result = analyze(candles)!;
    for (const candidate of result.candidates) {
      const total =
        candidate.targetProbability + candidate.stopProbability + candidate.neitherProbability;
      expect(total).toBeGreaterThan(99);
      expect(total).toBeLessThan(101);
    }
  });

  it("treats an extended price as chase risk rather than a green light", () => {
    const result = analyze(candles, { chasingPenalty: 80, overheatScore: 85 })!;
    expect(result.entryTiming).toBe("WAIT FOR PULLBACK");
  });

  it("rejects a setup whose reward does not clear the stop", () => {
    const result = analyze(walk({ volatility: 0.02, drift: 0, seed: 3 }), {
      atrPct: 9,
      structuralStopPrice: 100 * 0.9,
    })!;
    expect(["NO ENTRY", "NO ENTRY / POOR R:R"]).toContain(result.entryTiming);
  });

  it("evaluates LONG and SHORT independently on the same data", () => {
    const rising = walk({ volatility: 0.004, drift: 0.0012, seed: 5 });
    const long = analyze(rising, {}, "LONG")!;
    const short = analyze(rising, {}, "SHORT")!;
    expect(long.favorableAnyProbability).toBeGreaterThan(short.favorableAnyProbability);
    expect(long.direction).toBe("LONG");
    expect(short.direction).toBe("SHORT");
  });

  it("declines to estimate without enough history", () => {
    expect(analyze(walk({ volatility: 0.005, drift: 0, count: 40 }))).toBeNull();
  });
});
