import { describe, expect, it } from "vitest";
import { assessMarketDecision } from "./market-decision";
import type { MarketEnvSnapshot, SymbolAnalysis } from "@/lib/types/scoring";

function row(symbol: string): SymbolAnalysis {
  return {
    symbol,
    rankingEligible: true,
    availability: "SCORING_AVAILABLE",
    btcCorrelation: 0.4,
    futures: null,
    entryExpectancy: {
      long: { total: 84, rewardRisk: 2.4, reversalRisk: 25, expectedMoveScore: 80 },
      short: { total: 40, rewardRisk: 0.8, reversalRisk: 70, expectedMoveScore: 35 },
    },
  } as unknown as SymbolAnalysis;
}

function market(btcMove = 0.5): MarketEnvSnapshot {
  return {
    btc4h: { trend: "Strong Bullish" },
    btc: {
      indicators: {
        "1h": { trend: "Bullish", volumeRatio: 1.1 },
      },
      futures: { priceChange1hPct: btcMove, liquidation: 10 },
      regime: { regime: "TRENDING" },
    },
  } as unknown as MarketEnvSnapshot;
}

describe("assessMarketDecision", () => {
  it("returns ATTACK only when market and multiple setups align", () => {
    const result = assessMarketDecision(
      [row("BTCUSDT"), row("ETHUSDT"), row("SOLUSDT")],
      market(),
    );
    expect(result.attackLevel).toBe("ATTACK");
    expect(result.highOpportunityCount).toBe(3);
    expect(result.shock).toBe(false);
  });

  it("market shock overrides otherwise strong individual setups", () => {
    const result = assessMarketDecision(
      [row("BTCUSDT"), row("ETHUSDT"), row("SOLUSDT")],
      market(-4.2),
    );
    expect(result.shock).toBe(true);
    expect(result.attackLevel).toBe("DEFEND");
    expect(result.capitalPreservation).toBe(true);
  });
});
