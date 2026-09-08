import { describe, expect, it } from "vitest";
import { HORIZON_SPECS, evaluateOpportunity, type OpportunityInput } from "./opportunity";
import type { BtcRegime } from "@/lib/types/opportunity";
import type { Candle } from "@/lib/types/market";

function walk(options: {
  count?: number;
  volatility: number;
  drift: number;
  seed?: number;
  takerBias?: number | null;
}): Candle[] {
  const count = options.count ?? 300;
  let state = (options.seed ?? 7) >>> 0;
  const random = () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
  let price = 100;
  const candles: Candle[] = [];
  for (let i = 0; i < count; i += 1) {
    const shock = (random() - 0.5) * 2 * options.volatility;
    const open = price;
    price = Math.max(0.01, price * (1 + options.drift + shock));
    const volume = 1_000 + random() * 200;
    const openTime = i * 900_000;
    candles.push({
      openTime,
      open,
      high: Math.max(open, price) * (1 + options.volatility * 0.4),
      low: Math.min(open, price) * (1 - options.volatility * 0.4),
      close: price,
      volume,
      closeTime: openTime + 899_999,
      takerBuyVolume:
        options.takerBias == null ? null : volume * (0.5 + options.takerBias / 2),
    });
  }
  return candles;
}

const NEUTRAL: BtcRegime = {
  trend: "FLAT",
  atrPct: 0.4,
  state: "NEUTRAL",
  label: "test",
};

function evaluate(candles: Candle[], overrides: Partial<OpportunityInput> = {}) {
  return evaluateOpportunity({
    symbol: "SOLUSDT",
    display: "SOL/USDT",
    venue: "binance",
    candles,
    ticker: null,
    derivatives: null,
    regime: NEUTRAL,
    turnoverUsd: 50_000_000,
    ...overrides,
  });
}

describe("evaluateOpportunity", () => {
  const candles = walk({ volatility: 0.006, drift: 0 });

  it("evaluates both directions from one candle series", () => {
    const outcome = evaluate(candles);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.row.long).not.toBeNull();
    expect(outcome.row.short).not.toBeNull();
    expect(outcome.row.bestDirection).not.toBeNull();
  });

  it("reports every requested horizon with bounded probabilities", () => {
    const outcome = evaluate(candles);
    if (!outcome.ok || !outcome.row.long) throw new Error("expected a long side");
    const { horizons } = outcome.row.long;
    expect(horizons.map((horizon) => horizon.label)).toEqual(
      HORIZON_SPECS.map((spec) => spec.label),
    );
    expect(horizons.map((horizon) => horizon.levelPct)).toEqual(
      HORIZON_SPECS.map((spec) => spec.levelPct),
    );
    for (const horizon of horizons) {
      expect(horizon.probability).toBeGreaterThanOrEqual(0);
      expect(horizon.probability).toBeLessThanOrEqual(100);
      expect(horizon.stopProbability).toBeGreaterThanOrEqual(0);
      expect(horizon.stopProbability).toBeLessThanOrEqual(100);
    }
    expect(horizons.filter((horizon) => horizon.recommended)).toHaveLength(1);
  });

  it("never lowers the touch probability of the same level over a longer window", () => {
    const outcome = evaluate(candles);
    if (!outcome.ok || !outcome.row.long) throw new Error("expected a long side");
    const { horizons } = outcome.row.long;
    for (let i = 1; i < horizons.length; i += 1) {
      if (horizons[i].levelPct === horizons[i - 1].levelPct) {
        expect(horizons[i].probability).toBeGreaterThanOrEqual(horizons[i - 1].probability);
      }
      expect(horizons[i].stopProbability).toBeGreaterThanOrEqual(
        horizons[i - 1].stopProbability,
      );
    }
  });

  it("recommends the target with the best expected value at the chosen window", () => {
    const outcome = evaluate(candles);
    if (!outcome.ok || !outcome.row.long) throw new Error("expected a long side");
    const side = outcome.row.long;
    const recommended = side.targets.filter((target) => target.recommended);
    expect(recommended).toHaveLength(1);
    for (const target of side.targets) {
      expect(target.expectedValuePct).toBeLessThanOrEqual(
        recommended[0].expectedValuePct + 1e-9,
      );
    }
    expect(side.recommendedTargetPct).toBe(recommended[0].pct);
    expect(side.recommendedTargetPct).toBeGreaterThan(side.stop.pct);
  });

  it("keeps first-touch outcomes coherent for every target", () => {
    const outcome = evaluate(candles);
    if (!outcome.ok || !outcome.row.long) throw new Error("expected a long side");
    for (const target of outcome.row.long.targets) {
      const total =
        target.targetProbability + target.stopProbability + target.neitherProbability;
      expect(total).toBeGreaterThan(99);
      expect(total).toBeLessThan(101);
    }
  });

  it("charges fees, slippage and funding against the gross expected value", () => {
    const outcome = evaluate(candles, {
      derivatives: {
        fundingRate: 0.0005,
        fundingSource: "binance",
        openInterestUsd: 1_000_000,
        openInterestSource: "bybit",
      },
    });
    if (!outcome.ok || !outcome.row.long) throw new Error("expected a long side");
    const side = outcome.row.long;
    expect(side.costPct).toBeGreaterThan(0.14);
    for (const target of side.targets) {
      expect(target.expectedValuePct).toBeCloseTo(
        target.grossExpectedValuePct - target.costPct,
        10,
      );
    }
  });

  it("derives the stop from market state rather than a fixed distance", () => {
    const calm = evaluate(walk({ volatility: 0.002, drift: 0, seed: 21 }));
    const wild = evaluate(walk({ volatility: 0.02, drift: 0, seed: 21 }));
    if (!calm.ok || !wild.ok || !calm.row.long || !wild.row.long) {
      throw new Error("expected both sides");
    }
    expect(wild.row.long.stop.pct).toBeGreaterThan(calm.row.long.stop.pct);
    expect(calm.row.long.stop.reason.length).toBeGreaterThan(0);
  });

  it("lowers recommended leverage when volatility is high", () => {
    const calm = evaluate(walk({ volatility: 0.002, drift: 0, seed: 33 }));
    const wild = evaluate(walk({ volatility: 0.02, drift: 0, seed: 33 }));
    if (!calm.ok || !wild.ok || !calm.row.long || !wild.row.long) {
      throw new Error("expected both sides");
    }
    expect(wild.row.long.leverage.recommendedMax).toBeLessThan(
      calm.row.long.leverage.recommendedMax,
    );
    expect(wild.row.long.leverage.caps.length).toBeGreaterThan(0);
  });

  it("keeps the stop clear of liquidation at the recommended leverage", () => {
    const outcome = evaluate(candles);
    if (!outcome.ok) throw new Error("expected a row");
    for (const side of [outcome.row.long, outcome.row.short]) {
      if (!side) continue;
      const liquidationDistance = 100 / side.leverage.recommendedMax - 0.5;
      expect(side.stop.pct).toBeLessThan(liquidationDistance);
    }
  });

  it("treats an already extended move as chase risk", () => {
    const spike = walk({ volatility: 0.004, drift: 0, seed: 9 });
    // Push the last eight bars up hard, leaving price at the top of the range.
    for (let i = spike.length - 8; i < spike.length; i += 1) {
      const factor = 1 + 0.02 * (i - (spike.length - 9));
      spike[i] = {
        ...spike[i],
        open: spike[i].open * factor,
        high: spike[i].high * factor * 1.002,
        low: spike[i].low * factor,
        close: spike[i].close * factor,
      };
    }
    const outcome = evaluate(spike);
    if (!outcome.ok || !outcome.row.long) throw new Error("expected a long side");
    expect(outcome.row.long.chaseRisk).toBeGreaterThan(50);
    expect(["WAIT FOR PULLBACK", "NO ENTRY"]).toContain(outcome.row.long.verdict);
  });

  it("reads order flow only when the venue reports taker volume", () => {
    const withFlow = evaluate(walk({ volatility: 0.005, drift: 0, seed: 4, takerBias: 0.3 }));
    const withoutFlow = evaluate(walk({ volatility: 0.005, drift: 0, seed: 4 }));
    if (!withFlow.ok || !withoutFlow.ok) throw new Error("expected rows");
    expect(withFlow.row.orderFlowDelta).toBeCloseTo(0.3, 6);
    expect(withoutFlow.row.orderFlowDelta).toBeNull();
    expect(withoutFlow.row.notes.join()).toContain("Order Flow");
  });

  it("excludes a symbol only when the data cannot support an estimate", () => {
    const outcome = evaluate(walk({ volatility: 0.005, drift: 0, count: 80 }));
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.reason).toContain("15m足");
  });

  it("caps leverage harder in a risk-off BTC regime", () => {
    const quiet = walk({ volatility: 0.0015, drift: 0, seed: 15 });
    const neutral = evaluate(quiet);
    const riskOff = evaluate(quiet, {
      regime: { trend: "DOWN", atrPct: 1.5, state: "RISK_OFF", label: "risk off" },
    });
    if (!neutral.ok || !riskOff.ok || !neutral.row.long || !riskOff.row.long) {
      throw new Error("expected both rows");
    }
    expect(riskOff.row.long.leverage.maxSafe).toBeLessThanOrEqual(
      neutral.row.long.leverage.maxSafe,
    );
  });
});
