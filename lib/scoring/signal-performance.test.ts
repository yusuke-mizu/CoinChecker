import { describe, expect, it } from "vitest";
import { summarizeSignalPerformance } from "./signal-performance";
import { DEFAULT_SIGNAL_SETTINGS, transitionSignalStore } from "./signal-tracking";
import type { SignalObservation, SignalScoreSnapshot } from "@/lib/types/signals";

const snapshot: SignalScoreSnapshot = {
  scoreModel: "expectancy-v1",
  entry: 85,
  oppositeEntry: 30,
  timing: 80,
  oppositeTiming: 25,
  trend: 80,
  expectedMove: 80,
  potentialRewardPct: 6,
  potentialRiskPct: 3,
  rewardRisk: 2,
  chasingPenalty: 10,
  entryType: "PULLBACK",
  entryDecision: "ENTRY_NOW",
  range: 20,
  drift: 20,
  driftSide: "up",
  reversal: 15,
  futures: 50,
  dataQuality: 69,
  exitAlert: 10,
  price: 100,
  btcCorrelation: 0.4,
  confidence: "MEDIUM",
  marketVenue: "okx",
  signalLabel: "STRONG LONG CANDIDATE",
  observedAt: "2026-09-01T00:00:00.000Z",
  reasons: [],
};
const observation: SignalObservation = {
  symbol: "BTCUSDT",
  display: "BTC/USDT",
  direction: "LONG",
  isDominant: true,
  scoringAvailable: true,
  regime: "TRENDING",
  snapshot,
};

describe("historical signal performance", () => {
  it("withholds win rate until diversity and sample thresholds are met", () => {
    const base = transitionSignalStore(
      null,
      [observation],
      DEFAULT_SIGNAL_SETTINGS,
      "2026-09-01T00:00:00.000Z",
    ).signals[0];
    const insufficient = summarizeSignalPerformance([base])[0];
    expect(insufficient.ready).toBe(false);
    expect(insufficient.winRatePct).toBeNull();

    const samples = Array.from({ length: 30 }, (_, index) => ({
      ...base,
      id: `signal-${index}`,
      symbol: `COIN${index % 10}USDT`,
      createdAt: `2026-09-${String(1 + (index % 7)).padStart(2, "0")}T00:00:00.000Z`,
      performance: base.performance.map((checkpoint) =>
        checkpoint.horizon === "1h"
          ? {
              ...checkpoint,
              state: "OBSERVED" as const,
              sampledAt: checkpoint.targetAt,
              sampledPrice: index % 3 === 0 ? 99 : 102,
              lagMinutes: 0,
              returnPct: index % 3 === 0 ? -1 : 2,
            }
          : checkpoint,
      ),
    }));
    const ready = summarizeSignalPerformance(samples)[0];
    expect(ready.ready).toBe(true);
    expect(ready.sampleSize).toBe(30);
    expect(ready.winRatePct).toBeCloseTo(66.67, 1);
  });
});
