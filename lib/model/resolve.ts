import { fetchBinanceOhlcv } from "@/lib/market-data/binance";
import { mapPool } from "@/lib/util/pool";
import type { PredictionRecord, PredictionResult } from "@/lib/types/prediction";
import { BAR_MINUTES, excursions, resolveFirstTouch } from "./dataset";

/**
 * Attaches realised outcomes to predictions whose horizon has elapsed.
 *
 * The outcome is resolved from the candles that actually followed the recorded
 * entry timestamp, using the same first-touch rule (and the same pessimistic
 * same-bar tie-break) as the training labels. Scoring live predictions by a
 * different rule than the one the model learned would make the calibration
 * screen measure the discrepancy rather than the model.
 */
export async function resolvePredictions(
  records: PredictionRecord[],
  now = Date.now(),
): Promise<Array<{ id: string; result: PredictionResult }>> {
  const due = records.filter((record) => !record.result && Date.parse(record.resolvesAt) <= now);
  if (due.length === 0) return [];

  const bySymbol = new Map<string, PredictionRecord[]>();
  for (const record of due) {
    const list = bySymbol.get(record.symbol) ?? [];
    list.push(record);
    bySymbol.set(record.symbol, list);
  }

  const resolved: Array<{ id: string; result: PredictionResult }> = [];
  await mapPool(Array.from(bySymbol.entries()), 4, async ([symbol, group]) => {
    const oldest = Math.min(...group.map((record) => Date.parse(record.timestamp)));
    const barsNeeded = Math.ceil((now - oldest) / (BAR_MINUTES * 60_000)) + 40;
    let candles;
    try {
      candles = await fetchBinanceOhlcv(symbol, "15m", Math.min(1500, Math.max(60, barsNeeded)));
    } catch {
      return;
    }
    if (candles.length < 2) return;

    const highs = candles.map((candle) => candle.high);
    const lows = candles.map((candle) => candle.low);

    for (const record of group) {
      const entryTime = Date.parse(record.timestamp);
      // The entry bar is the last bar that had already closed at prediction time.
      let entryIndex = -1;
      for (let i = 0; i < candles.length; i += 1) {
        if (candles[i].openTime <= entryTime) entryIndex = i;
        else break;
      }
      const bars = Math.round(record.horizonMinutes / BAR_MINUTES);
      if (entryIndex < 0 || entryIndex + bars >= candles.length) continue;

      const outcome = resolveFirstTouch(
        highs,
        lows,
        entryIndex,
        record.entryPrice,
        record.direction,
        record.targetPct,
        record.stopPct,
        bars,
      );
      const excursion = excursions(
        highs,
        lows,
        entryIndex,
        record.entryPrice,
        record.direction,
        bars,
      );
      const exitClose = candles[entryIndex + bars].close;
      const rawReturn = ((exitClose - record.entryPrice) / record.entryPrice) * 100;
      const directional = record.direction === "LONG" ? rawReturn : -rawReturn;
      const returnPct =
        outcome.outcome === "TARGET"
          ? record.targetPct
          : outcome.outcome === "STOP"
            ? -record.stopPct
            : directional;

      resolved.push({
        id: record.id,
        result: {
          resolvedAt: new Date(candles[entryIndex + bars].closeTime).toISOString(),
          outcome: outcome.outcome,
          returnPct,
          maxFavorableExcursionPct: excursion.mfePct,
          maxAdverseExcursionPct: excursion.maePct,
          holdingMinutes: outcome.barsToOutcome * BAR_MINUTES,
          ambiguousSameBar: outcome.ambiguous,
        },
      });
    }
  });

  return resolved;
}
