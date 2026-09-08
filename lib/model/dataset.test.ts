import { describe, expect, it } from "vitest";
import { buildMarketContext, buildSymbolContext, extractStateFeatures, STATE_FEATURE_COUNT } from "@/lib/features/extract";
import { resample } from "@/lib/features/resample";
import type { Candle } from "@/lib/types/market";
import { buildSymbolDataset, excursions, MAX_HORIZON_BARS, resolveFirstTouch } from "./dataset";

const STEP = 15 * 60_000;

function candle(index: number, open: number, high: number, low: number, close: number): Candle {
  return {
    openTime: index * STEP,
    open,
    high,
    low,
    close,
    volume: 1000,
    closeTime: index * STEP + STEP - 1,
    takerBuyVolume: 550,
  };
}

/** Deterministic pseudo-random walk, so failures are reproducible. */
function syntheticSeries(length: number, seed = 7): Candle[] {
  let state = seed;
  const next = () => {
    state = (state * 1103515245 + 12345) % 2147483648;
    return state / 2147483648;
  };
  const out: Candle[] = [];
  let price = 100;
  for (let i = 0; i < length; i += 1) {
    const drift = (next() - 0.5) * 0.6;
    const open = price;
    const close = Math.max(1, price * (1 + drift / 100));
    const high = Math.max(open, close) * (1 + next() * 0.002);
    const low = Math.min(open, close) * (1 - next() * 0.002);
    out.push({
      openTime: i * STEP,
      open,
      high,
      low,
      close,
      volume: 500 + next() * 1000,
      closeTime: i * STEP + STEP - 1,
      takerBuyVolume: 250 + next() * 500,
    });
    price = close;
  }
  return out;
}

describe("resolveFirstTouch", () => {
  const entry = 100;

  it("reports the target when it is reached first", () => {
    const candles = [
      candle(0, 100, 100, 100, 100),
      candle(1, 100, 100.4, 99.9, 100.3),
      candle(2, 100.3, 101.2, 100.1, 101),
    ];
    const result = resolveFirstTouch(
      candles.map((c) => c.high),
      candles.map((c) => c.low),
      0,
      entry,
      "LONG",
      1,
      1,
      2,
    );
    expect(result.outcome).toBe("TARGET");
    expect(result.ambiguous).toBe(false);
    expect(result.barsToOutcome).toBe(2);
  });

  it("reports the stop when it is reached first", () => {
    const candles = [
      candle(0, 100, 100, 100, 100),
      candle(1, 100, 100.2, 98.9, 99),
      candle(2, 99, 101.5, 99, 101.2),
    ];
    const result = resolveFirstTouch(
      candles.map((c) => c.high),
      candles.map((c) => c.low),
      0,
      entry,
      "LONG",
      1,
      1,
      2,
    );
    expect(result.outcome).toBe("STOP");
    expect(result.barsToOutcome).toBe(1);
    // The target was still touched later in the window.
    expect(result.touched).toBe(true);
  });

  it("books a same-bar collision as a stop and flags it", () => {
    const candles = [candle(0, 100, 100, 100, 100), candle(1, 100, 101.5, 98.5, 100)];
    const result = resolveFirstTouch(
      candles.map((c) => c.high),
      candles.map((c) => c.low),
      0,
      entry,
      "LONG",
      1,
      1,
      1,
    );
    expect(result.outcome).toBe("STOP");
    expect(result.ambiguous).toBe(true);
  });

  it("mirrors the barriers for SHORT", () => {
    const candles = [candle(0, 100, 100, 100, 100), candle(1, 100, 100.2, 98.9, 99)];
    const result = resolveFirstTouch(
      candles.map((c) => c.high),
      candles.map((c) => c.low),
      0,
      entry,
      "SHORT",
      1,
      1,
      1,
    );
    expect(result.outcome).toBe("TARGET");
  });

  it("reports neither when the window closes untouched", () => {
    const candles = [candle(0, 100, 100, 100, 100), candle(1, 100, 100.2, 99.8, 100)];
    const result = resolveFirstTouch(
      candles.map((c) => c.high),
      candles.map((c) => c.low),
      0,
      entry,
      "LONG",
      1,
      1,
      1,
    );
    expect(result.outcome).toBe("NEITHER");
    expect(result.touched).toBe(false);
  });
});

describe("excursions", () => {
  it("measures favourable and adverse travel in the trade's direction", () => {
    const candles = [candle(0, 100, 100, 100, 100), candle(1, 100, 102, 98, 101)];
    const highs = candles.map((c) => c.high);
    const lows = candles.map((c) => c.low);
    expect(excursions(highs, lows, 0, 100, "LONG", 1)).toEqual({ mfePct: 2, maePct: 2 });
    const short = excursions(highs, lows, 0, 100, "SHORT", 1);
    expect(short.mfePct).toBeCloseTo(2);
    expect(short.maePct).toBeCloseTo(2);
  });
});

describe("look-ahead safety", () => {
  it("produces identical features whether or not future bars exist", () => {
    const full = syntheticSeries(700);
    const cut = 500;
    const truncated = full.slice(0, cut + 1);

    const fullContext = buildSymbolContext("TEST", full);
    const truncatedContext = buildSymbolContext("TEST", truncated);

    const a = extractStateFeatures(fullContext, cut, null);
    const b = extractStateFeatures(truncatedContext, cut, null);
    expect(a).not.toBeNull();
    expect(b).not.toBeNull();

    for (let i = 0; i < STATE_FEATURE_COUNT; i += 1) {
      // Any dependence on later bars would show up as a difference here.
      expect(b![i]).toBeCloseTo(a![i], 10);
    }
  });

  it("never labels a bar whose outcome window is incomplete", () => {
    const candles = syntheticSeries(600);
    const context = buildSymbolContext("TEST", candles);
    const dataset = buildSymbolDataset(context, null, {
      direction: "LONG",
      combosPerBar: 2,
      stride: 1,
      maxRows: 10_000,
    });
    expect(dataset.rows.length).toBeGreaterThan(0);
    const lastAllowed = candles[candles.length - 1 - MAX_HORIZON_BARS].openTime;
    for (const row of dataset.rows) {
      expect(row.time).toBeLessThanOrEqual(lastAllowed);
    }
  });
});

describe("resample", () => {
  it("only exposes an aggregate bar once it has closed", () => {
    const candles = syntheticSeries(64);
    const hourly = resample(candles, 4);
    expect(hourly.candles.length).toBe(16);

    for (let i = 0; i < candles.length; i += 1) {
      const aggregateIndex = hourly.indexFor[i];
      if (aggregateIndex < 0) continue;
      const aggregate = hourly.candles[aggregateIndex];
      // The aggregate must be finished at or before the base bar that reads it.
      expect(aggregate.closeTime).toBeLessThanOrEqual(candles[i].closeTime);
    }
  });

  it("aggregates OHLCV correctly", () => {
    const candles = syntheticSeries(8);
    const hourly = resample(candles, 4);
    const first = hourly.candles[0];
    expect(first.open).toBe(candles[0].open);
    expect(first.close).toBe(candles[3].close);
    expect(first.high).toBe(Math.max(...candles.slice(0, 4).map((c) => c.high)));
    expect(first.low).toBe(Math.min(...candles.slice(0, 4).map((c) => c.low)));
    expect(first.volume).toBeCloseTo(candles.slice(0, 4).reduce((a, c) => a + c.volume, 0));
  });
});

describe("market context", () => {
  it("aligns BTC features by candle open time", () => {
    const btc = syntheticSeries(600, 11);
    const market = buildMarketContext(btc);
    expect(market.indexByTime.get(btc[300].openTime)).toBe(300);
    expect(market.regimes.length).toBe(btc.length);
  });

  it("falls back to neutral encoding when timestamps do not line up", () => {
    const symbol = syntheticSeries(600, 3).map((c) => ({ ...c, openTime: c.openTime + 1 }));
    const market = buildMarketContext(syntheticSeries(600, 11));
    const context = buildSymbolContext("TEST", symbol);
    const features = extractStateFeatures(context, 500, market);
    expect(features).not.toBeNull();
    // The 13 BTC columns are the tail of the vector and stay at zero.
    for (let i = STATE_FEATURE_COUNT - 13; i < STATE_FEATURE_COUNT; i += 1) {
      expect(features![i]).toBe(0);
    }
  });
});
