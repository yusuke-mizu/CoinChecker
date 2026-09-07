import type { Candle, CoreTimeframe, DataQuality } from "@/lib/types/market";

const INTERVAL_MS: Record<CoreTimeframe | "5m", number> = {
  "5m": 5 * 60_000,
  "15m": 15 * 60_000,
  "1h": 60 * 60_000,
  "4h": 4 * 60 * 60_000,
};

const MIN_CANDLES = 210;

export function assessCandleQuality(
  candles: Candle[],
  timeframe: CoreTimeframe | "5m",
  now = Date.now(),
): DataQuality {
  const reasons: string[] = [];
  if (candles.length === 0) {
    return {
      ok: false,
      code: "DATA_ERROR",
      reasons: ["OHLCV empty"],
      candleCount: 0,
      lastOpenTime: null,
    };
  }

  const last = candles[candles.length - 1];
  const lastOpenTime = last.openTime;

  if (candles.length < MIN_CANDLES) {
    reasons.push(`Need ${MIN_CANDLES} candles for EMA200, got ${candles.length}`);
  }

  const hasInvalid = candles.some(
    (c) =>
      !(c.high >= c.low) ||
      c.open <= 0 ||
      c.close <= 0 ||
      c.high <= 0 ||
      c.low <= 0 ||
      !Number.isFinite(c.volume) ||
      c.volume < 0,
  );
  if (hasInvalid) {
    reasons.push("Invalid OHLC or volume values");
  }

  const gaps = countLargeGaps(candles, INTERVAL_MS[timeframe]);
  if (gaps > 8) {
    reasons.push(`Too many timestamp gaps (${gaps})`);
  }

  const maxAge = INTERVAL_MS[timeframe] * 2.5;
  if (now - lastOpenTime > maxAge) {
    reasons.push("Latest candle is stale");
    return {
      ok: false,
      code: "STALE",
      reasons,
      candleCount: candles.length,
      lastOpenTime,
    };
  }

  if (candles.length < MIN_CANDLES || hasInvalid) {
    return {
      ok: false,
      code: "DATA_INSUFFICIENT",
      reasons,
      candleCount: candles.length,
      lastOpenTime,
    };
  }

  return {
    ok: true,
    reasons,
    candleCount: candles.length,
    lastOpenTime,
  };
}

function countLargeGaps(candles: Candle[], intervalMs: number): number {
  let gaps = 0;
  for (let i = 1; i < candles.length; i += 1) {
    const delta = candles[i].openTime - candles[i - 1].openTime;
    if (delta > intervalMs * 2.5) gaps += 1;
  }
  return gaps;
}
