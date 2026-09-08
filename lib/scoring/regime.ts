import type { FuturesPositioning, TimeframeIndicators } from "@/lib/types/scoring";

export type MarketRegime =
  | "TRENDING"
  | "RANGING"
  | "BREAKOUT"
  | "HIGH VOLATILITY"
  | "LOW VOLATILITY"
  | "TRANSITION";

export type RegimeSnapshot = {
  regime: MarketRegime;
  direction: "UP" | "DOWN" | "NEUTRAL";
  trendScore: number;
  rangeScore: number;
  driftScore: number;
  driftSide: "up" | "down" | "none";
  breakout: boolean;
  reasons: string[];
};

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

function adx(tf: TimeframeIndicators | null): number {
  return tf?.adx ?? 0;
}

export function scoreTrendClarity(
  tf4h: TimeframeIndicators | null,
  tf1h: TimeframeIndicators | null,
  tf15m: TimeframeIndicators | null,
): number {
  let pts = 0;
  const tfs = [tf4h, tf1h, tf15m];
  for (const tf of tfs) {
    if (!tf) continue;
    if (tf.trend === "Strong Bullish" || tf.trend === "Strong Bearish") pts += 18;
    else if (tf.trend === "Bullish" || tf.trend === "Bearish") pts += 12;
    if (tf.structure === "HH_HL" || tf.structure === "LH_LL") pts += 8;
    if ((tf.adx ?? 0) >= 25) pts += 6;
  }
  const align =
    tf4h &&
    tf1h &&
    ((tf4h.trend.includes("Bull") && tf1h.trend.includes("Bull")) ||
      (tf4h.trend.includes("Bear") && tf1h.trend.includes("Bear")));
  if (align) pts += 10;
  return clamp(pts, 0, 100);
}

export function scoreRangeLikeness(
  tf4h: TimeframeIndicators | null,
  tf1h: TimeframeIndicators | null,
  tf15m: TimeframeIndicators | null,
): number {
  let pts = 0;
  const reasons: string[] = [];
  for (const tf of [tf4h, tf1h]) {
    if (!tf) continue;
    if (tf.trend === "Range" || tf.trend === "Unknown") pts += 18;
    if ((tf.adx ?? 0) > 0 && (tf.adx ?? 0) < 20) pts += 14;
    if (tf.structure === "MIXED" || tf.structure === "UNKNOWN") pts += 10;
    if ((tf.volumeRatio ?? 1) < 0.9) pts += 8;
  }
  if (tf4h && tf1h && tf4h.trend === "Range" && tf1h.trend === "Range") pts += 12;
  if (tf15m && (tf15m.adx ?? 0) < 18) pts += 8;
  void reasons;
  return clamp(pts, 0, 100);
}

export function scoreDrift(
  tf4h: TimeframeIndicators | null,
  tf1h: TimeframeIndicators | null,
): { score: number; side: "up" | "down" | "none" } {
  const down =
    (tf1h?.structure === "LH_LL" || tf4h?.structure === "LH_LL") &&
    (tf1h?.trend === "Bearish" || tf1h?.trend === "Range" || tf4h?.trend === "Range");
  const up =
    (tf1h?.structure === "HH_HL" || tf4h?.structure === "HH_HL") &&
    (tf1h?.trend === "Bullish" || tf1h?.trend === "Range" || tf4h?.trend === "Range");
  if (down && !up) return { score: clamp(55 + (tf1h?.structure === "LH_LL" ? 20 : 0), 0, 100), side: "down" };
  if (up && !down) return { score: clamp(55 + (tf1h?.structure === "HH_HL" ? 20 : 0), 0, 100), side: "up" };
  return { score: 20, side: "none" };
}

export function detectBreakout(
  tf15m: TimeframeIndicators | null,
  tf1h: TimeframeIndicators | null,
  futures: FuturesPositioning | null,
): boolean {
  const vol = (tf15m?.volumeRatio ?? 0) >= 1.5 || (tf1h?.volumeRatio ?? 0) >= 1.4;
  const oi = (futures?.oiChange15mPct ?? 0) >= 3 || (futures?.oiChange1hPct ?? 0) >= 4;
  const mom =
    tf15m?.macdBias === "Bullish" ||
    tf15m?.macdBias === "Bearish" ||
    (tf15m?.adx ?? 0) >= 22;
  return vol && (oi || mom);
}

export function assessRegime(input: {
  tf4h: TimeframeIndicators | null;
  tf1h: TimeframeIndicators | null;
  tf15m: TimeframeIndicators | null;
  futures: FuturesPositioning | null;
}): RegimeSnapshot {
  const trendScore = scoreTrendClarity(input.tf4h, input.tf1h, input.tf15m);
  const rangeScore = scoreRangeLikeness(input.tf4h, input.tf1h, input.tf15m);
  const drift = scoreDrift(input.tf4h, input.tf1h);
  const breakout = detectBreakout(input.tf15m, input.tf1h, input.futures);
  const volHigh = (input.tf15m?.volumeRatio ?? 0) >= 1.8 || (input.tf1h?.volumeRatio ?? 0) >= 1.6;
  const volLow = (input.tf15m?.volumeRatio ?? 1) < 0.75 && (input.tf1h?.volumeRatio ?? 1) < 0.85;
  const reasons: string[] = [];

  let regime: MarketRegime = "TRANSITION";
  if (breakout && volHigh) {
    regime = "BREAKOUT";
    reasons.push("出来高を伴うブレイク兆候");
  } else if (trendScore >= 62 && rangeScore < 55) {
    regime = "TRENDING";
    reasons.push("方向性が比較的明確");
  } else if (rangeScore >= 70) {
    regime = "RANGING";
    reasons.push("ADX低下・方向性の欠如");
  } else if (volHigh && trendScore >= 45) {
    regime = "HIGH VOLATILITY";
    reasons.push("出来高が大きく相場が荒い");
  } else if (volLow && rangeScore >= 50) {
    regime = "LOW VOLATILITY";
    reasons.push("出来高が細く動きが小さい");
  } else {
    reasons.push("トレンドとレンジの境目");
  }

  if (adx(input.tf4h) >= 28) reasons.push(`4H ADX ${adx(input.tf4h).toFixed(0)}`);
  if (drift.score >= 70) reasons.push(drift.side === "down" ? "下方向へDrift" : "上方向へDrift");

  return {
    regime,
    direction:
      (input.tf4h?.trend.includes("Bull") && input.tf1h?.trend.includes("Bull"))
        ? "UP"
        : (input.tf4h?.trend.includes("Bear") && input.tf1h?.trend.includes("Bear"))
          ? "DOWN"
          : "NEUTRAL",
    trendScore,
    rangeScore,
    driftScore: drift.score,
    driftSide: drift.side,
    breakout,
    reasons,
  };
}
