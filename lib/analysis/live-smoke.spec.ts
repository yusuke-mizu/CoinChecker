import { describe, expect, it } from "vitest";
import { CANDLE_LIMIT, evaluateOpportunity } from "./opportunity";
import { loadBulkDerivatives } from "@/lib/market-data/bulk-derivatives";
import { fetchVenueOhlcv } from "@/lib/market-data/venue-router";
import type { BtcRegime } from "@/lib/types/opportunity";

// Temporary live-network smoke check for the data wiring. Not part of the suite.
const SYMBOLS = ["BTCUSDT", "ETHUSDT", "SOLUSDT", "DOGEUSDT", "XRPUSDT"];

const REGIME: BtcRegime = { trend: "UP", atrPct: 0.3, state: "NEUTRAL", label: "smoke" };

describe("live data wiring", () => {
  it("fetches candles, bulk funding/OI and produces both sides", async () => {
    const derivatives = await loadBulkDerivatives();
    console.log(`bulk derivatives entries=${derivatives.size}`);
    const btc = derivatives.get("BTCUSDT");
    console.log(`BTCUSDT funding=${btc?.fundingRate} (${btc?.fundingSource}) oi=${btc?.openInterestUsd} (${btc?.openInterestSource})`);
    expect(derivatives.size).toBeGreaterThan(100);

    for (const symbol of SYMBOLS) {
      const started = Date.now();
      const candles = await fetchVenueOhlcv("binance", symbol, "15m", CANDLE_LIMIT);
      const takerCoverage = candles.filter((candle) => candle.takerBuyVolume != null).length;
      const outcome = evaluateOpportunity({
        symbol,
        display: symbol,
        venue: "binance",
        candles,
        ticker: null,
        derivatives: derivatives.get(symbol) ?? null,
        regime: REGIME,
        turnoverUsd: 1e9,
      });
      if (!outcome.ok) {
        console.log(`${symbol}: EXCLUDED ${outcome.reason}`);
        continue;
      }
      const row = outcome.row;
      console.log(
        `\n${symbol} ${Date.now() - started}ms candles=${candles.length} taker=${takerCoverage} px=${row.lastPrice} atr=${row.atrPct.toFixed(2)}% rsi=${row.rsi?.toFixed(0)} trend=${row.trend} funding=${row.fundingRatePct?.toFixed(4)}% flow=${row.orderFlowDelta?.toFixed(3)} ess=${row.effectiveSampleSize}/${row.sampleSize}`,
      );
      for (const side of [row.long, row.short]) {
        if (!side) continue;
        console.log(
          `  ${side.direction} ${side.verdict} ${"*".repeat(side.stars)} | TP ${side.targetRangeLabel} p=${side.profitProbability.toFixed(0)}% | SL -${side.stop.pct}% p=${side.stopProbability.toFixed(0)}% | EV ${side.expectedValuePct.toFixed(3)}% (${side.expectedValuePerHourPct.toFixed(3)}/h) | cost ${side.costPct.toFixed(2)}% | lev ${side.leverage.recommendedMin}-${side.leverage.recommendedMax}x | hold ${side.holding.label} | conf ${side.confidence} ${side.basis}`,
        );
        console.log(`    SL: ${side.stop.reason}`);
        console.log(
          `    ${side.horizons.map((h) => `${h.label}/${side.direction === "LONG" ? "+" : "-"}${h.levelPct}%=${h.probability.toFixed(0)}%`).join("  ")}`,
        );
      }
      expect(candles.length).toBeGreaterThan(200);
      expect(takerCoverage).toBe(candles.length);
    }
  }, 180_000);
});
