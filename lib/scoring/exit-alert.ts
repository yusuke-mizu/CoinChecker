import type {
  ExitAlert,
  ExitAlertLevel,
  ExitHierarchy,
  FuturesPositioning,
  TimeframeIndicators,
} from "@/lib/types/scoring";

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

export function scoreExitAlert(input: {
  side: "LONG" | "SHORT";
  tf4h: TimeframeIndicators | null;
  tf1h: TimeframeIndicators | null;
  tf15m: TimeframeIndicators | null;
  btc4h: TimeframeIndicators | null;
  futures?: FuturesPositioning | null;
  priceChangePct?: number | null;
  reversalScore?: number | null;
  trendScore?: number | null;
  oiNote?: string | null;
}): ExitAlert {
  const { side, tf4h, tf1h, tf15m, btc4h, futures } = input;
  const reasons: string[] = [];

  let trend = 0;
  const emaBreak = (tf: TimeframeIndicators | null) => {
    if (!tf?.lastClose || tf.ema20 == null) return false;
    return side === "LONG" ? tf.lastClose < tf.ema20 : tf.lastClose > tf.ema20;
  };
  if (emaBreak(tf15m)) {
    trend += 8;
    reasons.push("15M EMA崩れ");
  }
  if (emaBreak(tf1h)) {
    trend += 8;
    reasons.push("1H EMA崩れ");
  }
  if (side === "LONG" && tf1h?.structure === "LH_LL") {
    trend += 5;
    reasons.push("1H HL崩壊");
  }
  if (side === "SHORT" && tf1h?.structure === "HH_HL") {
    trend += 5;
    reasons.push("1H HH形成");
  }
  if (
    tf4h &&
    ((side === "LONG" && (tf4h.trend === "Bearish" || tf4h.trend === "Strong Bearish")) ||
      (side === "SHORT" && (tf4h.trend === "Bullish" || tf4h.trend === "Strong Bullish")))
  ) {
    trend += 4;
    reasons.push(`4H ${tf4h.trend}`);
  }
  trend = clamp(trend, 0, 25);

  let mom = 0;
  if (tf15m?.macdBias === (side === "LONG" ? "Bearish" : "Bullish")) {
    mom += 8;
    reasons.push("MACD cross");
  }
  if (tf15m?.divergence === (side === "LONG" ? "bearish" : "bullish")) {
    mom += 8;
    reasons.push("divergence");
  }
  if (tf15m?.rsi != null && ((side === "LONG" && tf15m.rsi < 48) || (side === "SHORT" && tf15m.rsi > 52))) {
    mom += 4;
  }
  mom = clamp(mom, 0, 20);

  let volPa = 0;
  if ((tf15m?.volumeRatio ?? 0) >= 1.5) {
    volPa += 7;
    reasons.push("volume spike");
  }
  const wick = side === "LONG" ? tf15m?.upperWick : tf15m?.lowerWick;
  if ((wick ?? 0) >= 0.4) volPa += 5;
  volPa = clamp(volPa, 0, 15);

  let fut = 0;
  if (futures?.availableOi) {
    const p = futures.priceChange1hPct ?? 0;
    const o = futures.oiChange1hPct ?? futures.oiChange15mPct ?? 0;
    if (side === "LONG" && p < 0 && o > 0) {
      fut += 8;
      reasons.push("Price DOWN + OI UP");
    }
    if (side === "SHORT" && p > 0 && o > 0) {
      fut += 8;
      reasons.push("Price UP + OI UP");
    }
    if (side === "LONG" && p < 0 && o < 0) {
      fut += 5;
      reasons.push("Long liquidation 兆候");
    }
    if (side === "SHORT" && p > 0 && o < 0) {
      fut += 5;
      reasons.push("Short covering / squeeze");
    }
    if (o >= 5 && p < 0 && side === "LONG") fut += 5;
  }
  if (futures?.availableFunding && futures.fundingPercentile != null) {
    if (side === "LONG" && futures.fundingPercentile <= 15) {
      fut += 7;
      reasons.push("Funding 極端にマイナスへ");
    }
    if (side === "SHORT" && futures.fundingPercentile >= 85) {
      fut += 7;
      reasons.push("Funding 極端にプラス");
    }
    if (side === "SHORT" && (futures.fundingPercentile ?? 50) <= 10) {
      fut += 4;
      reasons.push("Short overcrowding / squeeze risk");
    }
  }
  if (!futures?.availableOi && !futures?.availableFunding) {
    reasons.push("OI unavailable / Funding unavailable");
  }
  fut = clamp(fut, 0, 25);

  let mkt = 0;
  if (
    btc4h &&
    ((side === "LONG" && (btc4h.trend === "Bearish" || btc4h.trend === "Strong Bearish")) ||
      (side === "SHORT" && (btc4h.trend === "Bullish" || btc4h.trend === "Strong Bullish")))
  ) {
    mkt += 10;
    reasons.push(`BTC ${btc4h.trend}`);
  }
  mkt = clamp(mkt, 0, 15);

  const maxAvail = 25 + 20 + 15 + 15 + (futures?.availableOi || futures?.availableFunding ? 25 : 0);
  const raw = trend + mom + volPa + mkt + (futures?.availableOi || futures?.availableFunding ? fut : 0);
  let score = clamp(Math.round((raw / Math.max(1, maxAvail)) * 100), 0, 100);

  const layers =
    (emaBreak(tf15m) ? 1 : 0) + (emaBreak(tf1h) ? 1 : 0) + (tf4h && trend >= 12 ? 1 : 0);
  let hierarchy: ExitHierarchy = "NONE";
  if (layers >= 3) hierarchy = "LEVEL 3";
  else if (layers >= 2) hierarchy = "LEVEL 2";
  else if (layers >= 1) hierarchy = "LEVEL 1";
  if (hierarchy === "LEVEL 3" && fut >= 12) hierarchy = "LEVEL 4";
  if (layers < 2) score = Math.min(score, 49);

  const level: ExitAlertLevel =
    score >= 85 ? "CRITICAL" : score >= 70 ? "HIGH ALERT" : score >= 50 ? "CAUTION" : score >= 30 ? "WATCH" : "NORMAL";

  const pnl = input.priceChangePct;
  const rev = input.reversalScore ?? 0;
  const tr = input.trendScore ?? 50;
  let headline = hierarchy === "LEVEL 1" ? "短期調整" : hierarchy === "LEVEL 2" ? "反転警戒" : hierarchy === "LEVEL 3" ? "トレンド転換警戒" : hierarchy === "LEVEL 4" ? "強い反転シグナル" : "反転兆候は限定的";
  if (pnl != null && pnl > 0 && (rev >= 70 || score >= 70)) {
    headline = "利益確定・ポジション縮小を検討";
  } else if (pnl != null && pnl < 0 && tr < 45 && score >= 70) {
    headline = "トレンド悪化。損切り判断を強く検討";
  }

  return { score, level, hierarchy, reasons: reasons.slice(0, 12), headline };
}
