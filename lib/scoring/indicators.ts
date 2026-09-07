import {
  adx,
  lastEma,
  macd,
  priceStructure,
  rsiWilder,
  volumeRatio,
} from "@/lib/indicators";
import type { Candle, CoreTimeframe } from "@/lib/types/market";
import type {
  MacdBias,
  TimeframeIndicators,
  TrendLabel,
} from "@/lib/types/scoring";

export function computeTimeframeIndicators(
  timeframe: CoreTimeframe,
  candles: Candle[],
): TimeframeIndicators {
  const closes = candles.map((c) => c.close);
  const highs = candles.map((c) => c.high);
  const lows = candles.map((c) => c.low);
  const volumes = candles.map((c) => c.volume);
  const ema20 = lastEma(closes, 20);
  const ema50 = lastEma(closes, 50);
  const ema200 = lastEma(closes, 200);
  const rsi = rsiWilder(closes, 14);
  const macdResult = macd(closes);
  const adxResult = adx(highs, lows, closes, 14);
  const structure = priceStructure(highs, lows, 8);
  const volRatio = volumeRatio(volumes, 20);
  const macdBias: MacdBias =
    macdResult.hist == null
      ? "Neutral"
      : macdResult.hist > 0
        ? "Bullish"
        : macdResult.hist < 0
          ? "Bearish"
          : "Neutral";

  return {
    timeframe,
    ema20,
    ema50,
    ema200,
    rsi,
    macd: macdResult.macd,
    macdSignal: macdResult.signal,
    macdHist: macdResult.hist,
    macdBias,
    adx: adxResult.adx,
    plusDi: adxResult.plusDi,
    minusDi: adxResult.minusDi,
    volumeRatio: volRatio,
    structure,
    trend: classifyTrend({
      ema20,
      ema50,
      ema200,
      rsi,
      macdBias,
      adx: adxResult.adx,
      structure,
    }),
  };
}

function classifyTrend(input: {
  ema20: number | null;
  ema50: number | null;
  ema200: number | null;
  rsi: number | null;
  macdBias: MacdBias;
  adx: number | null;
  structure: TimeframeIndicators["structure"];
}): TrendLabel {
  const { ema20, ema50, ema200, rsi, macdBias, adx: adxValue, structure } = input;
  if (ema20 == null || ema50 == null || ema200 == null) return "Unknown";

  const stackedUp = ema20 > ema50 && ema50 > ema200;
  const stackedDown = ema20 < ema50 && ema50 < ema200;
  const strongAdx = (adxValue ?? 0) >= 25;
  const bullishMom = (rsi ?? 50) >= 52 && macdBias === "Bullish";
  const bearishMom = (rsi ?? 50) <= 48 && macdBias === "Bearish";

  if (stackedUp && structure === "HH_HL" && strongAdx && bullishMom) {
    return "Strong Bullish";
  }
  if (stackedDown && structure === "LH_LL" && strongAdx && bearishMom) {
    return "Strong Bearish";
  }
  if (stackedUp || (ema20 > ema50 && bullishMom)) return "Bullish";
  if (stackedDown || (ema20 < ema50 && bearishMom)) return "Bearish";
  return "Range";
}
