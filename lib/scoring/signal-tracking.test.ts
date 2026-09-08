import { describe, expect, it } from "vitest";
import {
  DEFAULT_SIGNAL_SETTINGS,
  priceChangeSinceSignal,
  scoreDeterioration,
  scoreTakeProfit,
  transitionSignalStore,
} from "./signal-tracking";
import type { SignalObservation, SignalScoreSnapshot } from "@/lib/types/signals";

function snapshot(overrides: Partial<SignalScoreSnapshot> = {}): SignalScoreSnapshot {
  return {
    scoreModel: "expectancy-v1",
    entry: 85,
    oppositeEntry: 35,
    timing: 82,
    oppositeTiming: 30,
    trend: 78,
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
    futures: 60,
    dataQuality: 69,
    exitAlert: 10,
    price: 100,
    btcCorrelation: 0.4,
    btcBeta: 1.1,
    confidence: "MEDIUM",
    marketVenue: "okx",
    signalLabel: "STRONG LONG CANDIDATE",
    observedAt: "2026-09-08T00:00:00.000Z",
    reasons: [],
    ...overrides,
  };
}

function observation(
  direction: "LONG" | "SHORT" = "LONG",
  overrides: Partial<SignalScoreSnapshot> = {},
): SignalObservation {
  return {
    symbol: "SOLUSDT",
    display: "SOL/USDT",
    direction,
    isDominant: true,
    scoringAvailable: true,
    regime: "TRENDING",
    snapshot: snapshot(overrides),
  };
}

describe("signal tracking scores", () => {
  it("is symmetric for long and short price changes", () => {
    expect(priceChangeSinceSignal("LONG", 100, 90)).toBe(-10);
    expect(priceChangeSinceSignal("SHORT", 100, 110)).toBe(-10);
    expect(priceChangeSinceSignal("SHORT", 100, 90)).toBe(10);
  });

  it("does not issue take-profit score while losing", () => {
    expect(scoreTakeProfit({
      priceChangePct: -2,
      peakFavorablePct: 5,
      deterioration: 90,
      exitAlert: 90,
      reversal: 90,
    })).toBe(0);
  });

  it("raises deterioration when entry, timing, edge and reversal worsen", () => {
    const current = snapshot({
      entry: 50,
      oppositeEntry: 75,
      timing: 35,
      reversal: 85,
      drift: 80,
      driftSide: "down",
    });
    expect(scoreDeterioration(snapshot(), current, "LONG")).toBeGreaterThanOrEqual(60);
  });
});

describe("signal lifecycle", () => {
  it("deduplicates by symbol and direction and can recover", () => {
    const started = transitionSignalStore(
      null,
      [observation(), observation()],
      DEFAULT_SIGNAL_SETTINGS,
      "2026-09-08T00:00:00.000Z",
    );
    expect(started.signals).toHaveLength(1);
    expect(started.signals[0].status).toBe("NEW");

    const weakened = transitionSignalStore(
      started,
      [observation("LONG", { entry: 60, timing: 45, reversal: 75, exitAlert: 55 })],
      DEFAULT_SIGNAL_SETTINGS,
      "2026-09-08T01:00:00.000Z",
    );
    expect(["WEAKENING", "EXIT_WATCH"]).toContain(weakened.signals[0].status);

    const recovered = transitionSignalStore(
      weakened,
      [observation()],
      DEFAULT_SIGNAL_SETTINGS,
      "2026-09-08T02:00:00.000Z",
    );
    expect(recovered.signals[0].status).toBe("ACTIVE");
  });

  it("expires after configured tracking duration", () => {
    const started = transitionSignalStore(
      null,
      [observation()],
      DEFAULT_SIGNAL_SETTINGS,
      "2026-09-08T00:00:00.000Z",
    );
    const expired = transitionSignalStore(
      started,
      [],
      DEFAULT_SIGNAL_SETTINGS,
      "2026-09-09T00:00:01.000Z",
    );
    expect(expired.signals[0].status).toBe("EXPIRED");
  });

  it("raises stop-loss watch at ten percent adverse movement", () => {
    const started = transitionSignalStore(
      null,
      [observation()],
      DEFAULT_SIGNAL_SETTINGS,
      "2026-09-08T00:00:00.000Z",
    );
    const stopped = transitionSignalStore(
      started,
      [observation("LONG", { price: 90 })],
      DEFAULT_SIGNAL_SETTINGS,
      "2026-09-08T01:00:00.000Z",
    );
    expect(stopped.signals[0].status).toBe("STOP_LOSS_WATCH");
  });

  it("admits only configured top N dominant signals", () => {
    const second = {
      ...observation(),
      symbol: "ETHUSDT",
      display: "ETH/USDT",
      snapshot: snapshot({ entry: 90 }),
    };
    const nonDominant = {
      ...observation("SHORT"),
      symbol: "BTCUSDT",
      display: "BTC/USDT",
      isDominant: false,
      snapshot: snapshot({ entry: 95 }),
    };
    const store = transitionSignalStore(
      null,
      [observation(), second, nonDominant],
      { ...DEFAULT_SIGNAL_SETTINGS, topN: 1 },
      "2026-09-08T00:00:00.000Z",
    );
    expect(store.signals.map((item) => item.symbol)).toEqual(["ETHUSDT"]);
  });

  it("records scan-based horizon returns with actual lag", () => {
    const started = transitionSignalStore(
      null,
      [observation()],
      DEFAULT_SIGNAL_SETTINGS,
      "2026-09-08T00:00:00.000Z",
    );
    const measured = transitionSignalStore(
      started,
      [observation("LONG", { price: 105 })],
      DEFAULT_SIGNAL_SETTINGS,
      "2026-09-08T01:15:00.000Z",
    );
    const oneHour = measured.signals[0].performance.find((item) => item.horizon === "1h");
    expect(oneHour?.state).toBe("OBSERVED");
    expect(oneHour?.lagMinutes).toBe(15);
    expect(oneHour?.returnPct).toBe(5);
  });

  it("captures a pending 24h outcome before expiring the signal", () => {
    const started = transitionSignalStore(
      null,
      [observation()],
      DEFAULT_SIGNAL_SETTINGS,
      "2026-09-08T00:00:00.000Z",
    );
    const measured = transitionSignalStore(
      started,
      [observation("LONG", { price: 103 })],
      DEFAULT_SIGNAL_SETTINGS,
      "2026-09-09T00:10:00.000Z",
    );
    const day = measured.signals[0].performance.find((item) => item.horizon === "24h");
    expect(day?.state).toBe("OBSERVED");
    expect(measured.signals[0].status).toBe("EXPIRED");
  });
});
