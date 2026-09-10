import { describe, expect, it } from "vitest";
import { buildMarketContext } from "@/lib/features/extract";
import { fetchBinanceOhlcv, fetchBinanceOhlcvHistory } from "@/lib/market-data/binance";
import { loadBulkDerivatives } from "@/lib/market-data/bulk-derivatives";
import { trainModel } from "@/lib/model/train";
import { CANDLE_LIMIT, evaluateOpportunity } from "@/lib/analysis/opportunity";
import type { BtcRegime } from "@/lib/types/opportunity";
import type { TrainedModel } from "@/lib/types/prediction";

/**
 * Live network smoke test. Not part of the default suite -- run explicitly with
 * `npx vitest run lib/analysis/live-smoke.spec.ts`. It trains a small model
 * against real Binance history and scores a few symbols through the same code
 * path the scan uses.
 */

const REGIME: BtcRegime = {
  trend: "FLAT",
  atrPct: 0.3,
  state: "NEUTRAL",
  label: "smoke",
};

describe("live model pipeline", () => {
  it(
    "trains on real history and produces calibrated probabilities",
    async () => {
      const started = Date.now();
      const model: TrainedModel = await trainModel(
        { symbols: ["BTCUSDT", "ETHUSDT", "SOLUSDT", "XRPUSDT"], barsPerSymbol: 1500 },
        (message) => console.log(`  [train] ${message}`),
      );
      const elapsed = Date.now() - started;

      console.log(`\ntrained ${model.version} in ${(elapsed / 1000).toFixed(1)}s`);
      console.log(
        `rows=${model.training.totalRows} ambiguous=${model.training.ambiguousSameBarRows} ` +
          `period=${model.training.firstSampleAt.slice(0, 10)}..${model.training.lastSampleAt.slice(0, 10)}`,
      );
      for (const side of [model.long, model.short]) {
        for (const head of [side.reach, side.target, side.stop]) {
          console.log(
            `  ${side.direction} ${head.outcome.padEnd(6)} ` +
              `auc=${head.metrics.auc.toFixed(3)} brier=${head.metrics.brier.toFixed(4)} ` +
              `(prior ${head.metrics.baselineBrier.toFixed(4)}) ` +
              `ece=${(head.calibration.expectedCalibrationError * 100).toFixed(2)}pt ` +
              `rows=${head.model.trainRows} base=${(head.metrics.positiveRate * 100).toFixed(1)}%`,
          );
        }
      }
      console.log("  top features (LONG target):");
      for (const entry of model.long.target.importance.slice(0, 8)) {
        console.log(`    ${entry.name.padEnd(20)} ${entry.weight >= 0 ? "+" : ""}${entry.weight.toFixed(3)}`);
      }
      for (const fold of model.walkForward) {
        console.log(
          `  fold#${fold.index} test=${fold.testRows} auc=${fold.metrics.auc.toFixed(3)} ` +
            `brier=${fold.metrics.brier.toFixed(4)} (prior ${fold.metrics.baselineBrier.toFixed(4)})`,
        );
      }

      expect(model.training.totalRows).toBeGreaterThan(2000);
      // The model has to beat the analytic first-passage prior it is given.
      expect(model.long.target.metrics.brier).toBeLessThan(
        model.long.target.metrics.baselineBrier,
      );
      expect(model.long.target.metrics.auc).toBeGreaterThan(0.5);
      expect(model.long.target.calibration.expectedCalibrationError).toBeLessThan(0.06);

      // --- score live symbols through the scan's own path ---
      const [derivatives, btc] = await Promise.all([
        loadBulkDerivatives().catch(() => new Map()),
        fetchBinanceOhlcv("BTCUSDT", "15m", CANDLE_LIMIT),
      ]);
      const market = buildMarketContext(btc);

      for (const symbol of ["BTCUSDT", "ETHUSDT", "SOLUSDT", "DOGEUSDT"]) {
        const candles = await fetchBinanceOhlcvHistory(symbol, "15m", CANDLE_LIMIT);
        const outcome = evaluateOpportunity({
          symbol,
          display: symbol,
          venue: "binance",
          candles,
          ticker: null,
          derivatives: derivatives.get(symbol) ?? null,
          regime: REGIME,
          turnoverUsd: 50_000_000,
          model,
          market,
        });
        if (!outcome.ok) {
          console.log(`\n${symbol}: excluded — ${outcome.reason}`);
          continue;
        }
        const row = outcome.row;
        console.log(
          `\n${symbol} px=${row.lastPrice} atr=${row.atrPct.toFixed(2)}% rsi=${row.rsi?.toFixed(0)} ` +
            `notes=${row.notes.join("; ") || "-"}`,
        );
        for (const side of [row.long, row.short]) {
          if (!side) continue;
          console.log(
            `  ${side.direction.padEnd(5)} ${side.verdict.padEnd(14)} basis=${side.basis} ` +
              `TP +${side.recommendedTargetPct}% p=${side.profitProbability.toFixed(0)}% ` +
              `SL -${side.stop.pct}% p=${side.stopProbability.toFixed(0)}% ` +
              `EV ${side.expectedValuePct.toFixed(3)}% conf=${side.confidence} lev=${side.leverage.recommendedMin}-${side.leverage.recommendedMax}x ` +
              `hold=${side.holding.label}`,
          );
          console.log(
            `    ${side.horizons.map((h) => `${h.label}/${h.levelPct}%=${h.probability.toFixed(0)}%`).join("  ")}`,
          );
          console.log(`    why: ${side.reasons.slice(2).join(" / ") || "-"}`);
        }
        // Probability of touching a level cannot fall as the window lengthens.
        for (const side of [row.long, row.short]) {
          if (!side) continue;
          for (let i = 1; i < side.horizons.length; i += 1) {
            if (side.horizons[i].levelPct === side.horizons[i - 1].levelPct) {
              expect(side.horizons[i].probability).toBeGreaterThanOrEqual(
                side.horizons[i - 1].probability - 1e-9,
              );
            }
          }
          expect(side.basis).toBe("LEARNED");
        }
        expect(outcome.predictions.every((record) => record.result === null)).toBe(true);
      }
    },
    600_000,
  );
});
