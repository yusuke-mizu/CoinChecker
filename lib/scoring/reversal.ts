import type { FuturesPositioning, ReversalAssessment, ScoreBreakdownItem, TimeframeIndicators } from "@/lib/types/scoring";

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

function item(key: string, label: string, points: number, max: number, reason: string): ScoreBreakdownItem {
  return { key, label, points: clamp(points, 0, max), max, reason };
}

function oneSide(
  side: "bullish" | "bearish",
  tf4h: TimeframeIndicators | null,
  tf1h: TimeframeIndicators | null,
  tf15: TimeframeIndicators | null,
  btc4h: TimeframeIndicators | null,
  futures: FuturesPositioning | null,
): { total: number; reasons: string[]; items: ScoreBreakdownItem[] } {
  const wantMacd = side === "bullish" ? "Bullish" : "Bearish";
  const wantDiv = side === "bullish" ? "bullish" : "bearish";
  const wantStruct = side === "bullish" ? "HH_HL" : "LH_LL";
  const rsi = tf15?.rsi ?? tf1h?.rsi;
  let rsiPts = 0;
  if (rsi != null) {
    rsiPts =
      side === "bullish"
        ? rsi <= 32
          ? 10
          : rsi <= 45
            ? 6
            : 2
        : rsi >= 68
          ? 10
          : rsi >= 55
            ? 6
            : 2;
  }
  const divHit = tf15?.divergence === wantDiv || tf1h?.divergence === wantDiv;
  const macdHit = tf15?.macdBias === wantMacd;
  const vol = (tf15?.volumeRatio ?? 0) >= 1.3 ? 12 : (tf15?.volumeRatio ?? 0) >= 1.0 ? 6 : 2;
  const wick = side === "bullish" ? tf15?.lowerWick : tf15?.upperWick;
  const candle = (wick ?? 0) >= 0.4 ? 10 : 3;
  const ema =
    tf15?.lastClose != null && tf15.ema20 != null
      ? side === "bullish"
        ? tf15.lastClose > tf15.ema20
          ? 10
          : 2
        : tf15.lastClose < tf15.ema20
          ? 10
          : 2
      : 0;
  const struct = tf15?.structure === wantStruct ? 10 : 3;
  let oi = 0;
  const reasons: string[] = [];
  if (futures?.availableOi) {
    const p = futures.priceChange1hPct ?? 0;
    const o = futures.oiChange1hPct ?? futures.oiChange15mPct ?? 0;
    if (side === "bullish" && p < 0 && o < 0) {
      oi += 5;
      reasons.push("Price DOWN + OI DOWN");
    }
    if (side === "bearish" && p > 0 && o < 0) {
      oi += 5;
      reasons.push("Price UP + OI DOWN");
    }
    if ((o ?? 0) <= -5) oi += 2;
    if ((tf15?.volumeRatio ?? 0) >= 1.5) oi += 1;
    if (futures.flags.includes("LONG LIQUIDATION CANDIDATE") && side === "bullish") oi += 2;
    if (futures.flags.includes("SHORT SQUEEZE CANDIDATE") && side === "bearish") oi += 2;
  }
  oi = clamp(oi, 0, 10);
  let fund = 0;
  if (futures?.availableFunding && futures.fundingRate != null) {
    const pctl = futures.fundingPercentile ?? 50;
    if (side === "bullish" && pctl <= 15) fund += 3;
    if (side === "bearish" && pctl >= 85) fund += 3;
    if (futures.fundingChange != null) {
      if (side === "bullish" && futures.fundingChange > 0) fund += 2;
      if (side === "bearish" && futures.fundingChange < 0) fund += 2;
    }
  }
  fund = clamp(fund, 0, 5);
  const btc =
    btc4h &&
    ((side === "bullish" && (btc4h.trend === "Bullish" || btc4h.trend === "Strong Bullish")) ||
      (side === "bearish" && (btc4h.trend === "Bearish" || btc4h.trend === "Strong Bearish")))
      ? 5
      : 1;

  const items = [
    item("rsi", "RSI", rsiPts, 10, rsi != null ? `RSI ${rsi.toFixed(1)}` : "unavailable"),
    item("div", "RSI divergence", divHit ? 15 : 3, 15, divHit ? `${wantDiv} divergence` : "no divergence"),
    item("macd", "MACD", macdHit ? 10 : 2, 10, `15M MACD ${tf15?.macdBias ?? "n/a"}`),
    item("vol", "Volume", vol, 15, `vol ratio ${tf15?.volumeRatio?.toFixed(2) ?? "n/a"}`),
    item("candle", "Candlestick", candle, 10, "wick / rejection"),
    item("ema", "EMA recover/break", ema, 10, "15M vs EMA20"),
    item("struct", "Structure", struct, 10, tf15?.structure ?? "n/a"),
    item("oi", "OI", oi, 10, futures?.availableOi ? "OI used" : "OI unavailable"),
    item("fund", "Funding", fund, 5, futures?.availableFunding ? "Funding used" : "Funding unavailable"),
    item("btc", "BTC alignment", btc, 5, btc4h?.trend ?? "n/a"),
  ];
  const raw = items.reduce((s, i) => s + i.points, 0);
  const max = items.reduce((s, i) => s + i.max, 0);
  const missing = (!futures?.availableOi ? 10 : 0) + (!futures?.availableFunding ? 5 : 0);
  const total = clamp(Math.round((raw / Math.max(1, max - missing)) * 100), 0, 100);
  return { total, reasons: items.filter((i) => i.points >= i.max * 0.5).map((i) => i.reason), items };
}

export function scoreReversal(input: {
  tf4h: TimeframeIndicators | null;
  tf1h: TimeframeIndicators | null;
  tf15m: TimeframeIndicators | null;
  btc4h: TimeframeIndicators | null;
  futures?: FuturesPositioning | null;
}): ReversalAssessment {
  const bull = oneSide("bullish", input.tf4h, input.tf1h, input.tf15m, input.btc4h, input.futures ?? null);
  const bear = oneSide("bearish", input.tf4h, input.tf1h, input.tf15m, input.btc4h, input.futures ?? null);
  let signal: ReversalAssessment["signal"] = "NO REVERSAL";
  if (bull.total >= 60 && bull.total - bear.total >= 12) signal = "BULLISH REVERSAL";
  else if (bear.total >= 60 && bear.total - bull.total >= 12) signal = "BEARISH REVERSAL";
  const reasons = signal === "BULLISH REVERSAL" ? bull.reasons : signal === "BEARISH REVERSAL" ? bear.reasons : [];
  return {
    bullish: bull.total,
    bearish: bear.total,
    signal,
    reasons,
    itemsBull: bull.items,
    itemsBear: bear.items,
  };
}
