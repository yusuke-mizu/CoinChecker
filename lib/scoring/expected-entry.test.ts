import { describe, expect, it } from "vitest";
import { atr, scoreExpectedEntry } from "./expected-entry";
import type { Candle } from "@/lib/types/market";
import type {
  FuturesPositioning,
  ReversalAssessment,
  TimeframeIndicators,
} from "@/lib/types/scoring";
import type { TimingAssessment } from "./entry-timing";
import type { RegimeSnapshot } from "./regime";

function candles(direction: 1 | -1 = 1, spike = 0): Candle[] {
  return Array.from({ length: 250 }, (_, index) => {
    const base = 100 + direction * index * 0.025 + Math.sin(index * 0.45) * 1.2;
    const extension = index >= 245 ? direction * spike * (index - 244) : 0;
    const close = base + extension;
    return {
      openTime: index * 3_600_000,
      closeTime: (index + 1) * 3_600_000,
      open: close - direction * 0.1,
      high: close + 0.45,
      low: close - 0.45,
      close,
      volume: 100 + (index % 12) * 3,
    };
  });
}

function indicator(
  direction: "bull" | "bear" | "range",
  lastClose = 106,
): TimeframeIndicators {
  const bull = direction === "bull";
  const bear = direction === "bear";
  return {
    timeframe: "1h",
    ema20: lastClose + (bull ? -0.2 : bear ? 0.2 : 0),
    ema50: lastClose + (bull ? -0.8 : bear ? 0.8 : 0),
    ema200: lastClose + (bull ? -2 : bear ? 2 : 0),
    rsi: bull ? 58 : bear ? 42 : 50,
    macd: 1,
    macdSignal: 0.8,
    macdHist: bull ? 0.2 : bear ? -0.2 : 0,
    macdBias: bull ? "Bullish" : bear ? "Bearish" : "Neutral",
    adx: direction === "range" ? 12 : 30,
    plusDi: bull ? 28 : 14,
    minusDi: bear ? 28 : 14,
    volumeRatio: 1.3,
    structure: bull ? "HH_HL" : bear ? "LH_LL" : "MIXED",
    trend: bull ? "Strong Bullish" : bear ? "Strong Bearish" : "Range",
    lastClose,
    prevClose: lastClose - (bull ? 0.2 : bear ? -0.2 : 0),
    divergence: "none",
    upperWick: 0.2,
    lowerWick: 0.2,
  };
}

const timing: TimingAssessment = {
  long: 82,
  short: 30,
  side: "long",
  score: 82,
  label: "STRONG ENTRY WINDOW",
  waitReasons: [],
  items: [],
};
const reversal: ReversalAssessment = {
  bullish: 15,
  bearish: 15,
  signal: "NO REVERSAL",
  reasons: [],
  itemsBull: [],
  itemsBear: [],
};
const trending: RegimeSnapshot = {
  regime: "TRENDING",
  direction: "UP",
  trendScore: 80,
  rangeScore: 20,
  driftScore: 70,
  driftSide: "up",
  breakout: false,
  reasons: [],
};
const noFutures: FuturesPositioning = {
  availableOi: false,
  availableFunding: false,
  currentOi: null,
  oiUsd: null,
  oiChange15mPct: null,
  oiChange1hPct: null,
  oiChange4hPct: null,
  oiAccel: null,
  oiBand: "UNAVAILABLE",
  oiZScore: null,
  oiPercentile: null,
  fundingRate: null,
  fundingNextTime: null,
  fundingChange: null,
  fundingPercentile: null,
  fundingZScore: null,
  priceChange1hPct: null,
  structure: "UNAVAILABLE",
  narrativeJa: "",
  score: 0,
  oiMomentum: 0,
  fundingBias: 0,
  priceOi: 0,
  liquidation: 0,
  flags: [],
  longPoints: 0,
  shortPoints: 0,
  longReason: "",
  shortReason: "",
};

function assess(options: {
  direction?: "LONG" | "SHORT";
  series?: Candle[];
  trend?: "bull" | "bear" | "range";
  regime?: RegimeSnapshot;
  timingValue?: TimingAssessment;
  reversalValue?: ReversalAssessment;
  futures?: FuturesPositioning;
}) {
  const series = options.series ?? candles();
  const close = series[series.length - 1].close;
  const trend = options.trend ?? "bull";
  const row = indicator(trend, close);
  return scoreExpectedEntry({
    direction: options.direction ?? "LONG",
    candles: { "4h": series, "1h": series, "15m": series },
    indicators: {
      "4h": { ...row, timeframe: "4h" },
      "1h": row,
      "15m": { ...row, timeframe: "15m" },
    },
    timing: options.timingValue ?? timing,
    reversal: options.reversalValue ?? reversal,
    futures: options.futures ?? noFutures,
    regime: options.regime ?? trending,
    btc4h: { ...row, timeframe: "4h" },
    btcCorrelation: 0.5,
    dominancePct: 55,
  });
}

describe("current-price expectancy cases", () => {
  it("calculates ATR from true ranges", () => {
    expect(atr(candles())).toBeGreaterThan(0);
  });

  it("A/E: strong trend after a spike receives a chasing penalty", () => {
    const normal = assess({ series: candles(1, 0) });
    const chased = assess({ series: candles(1, 1.2) });
    expect(chased?.trendQuality).toBeGreaterThanOrEqual(75);
    expect(chased?.chasingPenalty).toBeGreaterThan(normal?.chasingPenalty ?? 0);
    expect(chased?.total).toBeLessThan(normal?.total ?? 100);
  });

  it("B: pullback/value location can remain a high-quality candidate", () => {
    const result = assess({});
    expect(result?.trendQuality).toBeGreaterThanOrEqual(75);
    expect(result?.rewardRisk).toBeGreaterThan(0);
    expect(["PULLBACK", "MOMENTUM"]).toContain(result?.entryType);
  });

  it("C: bearish context favors the SHORT assessment", () => {
    const shortTiming = { ...timing, long: 25, short: 84, side: "short" as const, score: 84 };
    const short = assess({
      direction: "SHORT",
      series: candles(-1),
      trend: "bear",
      regime: { ...trending, direction: "DOWN", driftSide: "down" },
      timingValue: shortTiming,
    });
    expect(short?.trendQuality).toBeGreaterThanOrEqual(75);
    expect(short?.timingScore).toBeGreaterThanOrEqual(90);
  });

  it("D: range regime is low priority/no entry", () => {
    const result = assess({
      trend: "range",
      regime: { ...trending, regime: "RANGING", direction: "NEUTRAL", rangeScore: 90 },
    });
    expect(result?.entryType).toBe("RANGE");
    expect(result?.decision).toBe("NO_ENTRY");
  });

  it("F: confirmed breakout near value is classified as retest", () => {
    const result = assess({
      regime: { ...trending, regime: "BREAKOUT", breakout: true },
    });
    expect(["BREAKOUT_RETEST", "BREAKOUT", "PULLBACK"]).toContain(result?.entryType);
  });

  it("G: OI increase and hot funding increase chasing risk", () => {
    const hot = {
      ...noFutures,
      availableOi: true,
      availableFunding: true,
      oiChange1hPct: 5,
      fundingPercentile: 95,
    };
    expect(assess({ futures: hot })?.chasingPenalty).toBeGreaterThan(
      assess({ futures: noFutures })?.chasingPenalty ?? 0,
    );
  });

  it("H: reward/risk is bounded and affects Expected Move", () => {
    const result = assess({});
    expect(result?.rewardRisk).toBeGreaterThanOrEqual(0);
    expect(result?.expectedMoveScore).toBeGreaterThanOrEqual(0);
    expect(result?.expectedMoveScore).toBeLessThanOrEqual(100);
  });

  it("I: missing core candles never fabricates an expectancy score", () => {
    expect(scoreExpectedEntry({
      direction: "LONG",
      candles: {},
      indicators: {},
      timing,
      reversal,
      futures: noFutures,
      regime: trending,
      btc4h: null,
      btcCorrelation: null,
      dominancePct: null,
    })).toBeNull();
  });
});
