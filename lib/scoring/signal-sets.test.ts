import { describe, expect, it } from "vitest";
import { buildBalancedSignalSet } from "./signal-sets";
import { DEFAULT_SIGNAL_SETTINGS, transitionSignalStore } from "./signal-tracking";
import type { SignalObservation, SignalScoreSnapshot } from "@/lib/types/signals";

function input(symbol: string, direction: "LONG" | "SHORT"): SignalObservation {
  const snapshot: SignalScoreSnapshot = {
    entry: 85,
    oppositeEntry: 35,
    timing: 80,
    oppositeTiming: 30,
    trend: 80,
    range: 20,
    drift: 20,
    driftSide: direction === "LONG" ? "up" : "down",
    reversal: 10,
    futures: 50,
    dataQuality: 69,
    exitAlert: 10,
    price: 100,
    btcCorrelation: 0.4,
    confidence: "MEDIUM",
    marketVenue: "okx",
    signalLabel: direction === "LONG" ? "STRONG LONG CANDIDATE" : "STRONG SHORT CANDIDATE",
    observedAt: "2026-09-08T00:00:00.000Z",
    reasons: [],
  };
  return {
    symbol,
    display: symbol,
    direction,
    isDominant: true,
    scoringAvailable: true,
    regime: "TRENDING",
    snapshot,
  };
}

describe("balanced signal set", () => {
  it("combines available long and short tracked signals", () => {
    const store = transitionSignalStore(
      null,
      [input("BTCUSDT", "LONG"), input("ETHUSDT", "SHORT")],
      DEFAULT_SIGNAL_SETTINGS,
      "2026-09-08T00:00:00.000Z",
    );
    const result = buildBalancedSignalSet(store.signals, 2);
    expect(result?.members).toHaveLength(2);
    expect(result?.status).toBe("ACTIVE");
    expect(result?.profitProtection).toBe(false);
  });
});
