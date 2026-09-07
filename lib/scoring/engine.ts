import type { TimeframeIndicators } from "@/lib/types/scoring";
import type { ScoreBreakdownItem } from "@/lib/types/scoring";

export type MarketEnvInput = {
  btc4h: TimeframeIndicators | null;
  dominancePct?: number | null;
  isBtc?: boolean;
};

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

function signed(n: number): string {
  return `${n >= 0 ? "+" : ""}${n}`;
}

function btcMarketPoints(input: MarketEnvInput, direction: "long" | "short") {
  const parts: string[] = [];
  let points = 0;
  const btc4h = input.btc4h;

  if (!btc4h) {
    parts.push("BTC 4H data unavailable");
  } else {
    const map: Record<string, number> = {
      "Strong Bullish": 8,
      Bullish: 5,
      Range: 0,
      Bearish: -5,
      "Strong Bearish": -8,
      Unknown: 0,
    };
    const raw = map[btc4h.trend] ?? 0;
    const trendPts = direction === "long" ? raw : -raw;
    points += trendPts;
    parts.push(`BTC 4H ${btc4h.trend} (${signed(trendPts)})`);
  }

  const dominance = input.dominancePct;
  if (dominance == null) {
    parts.push("BTC dominance unavailable");
  } else {
    const isBtc = input.isBtc === true;
    let domPts = 0;
    if (dominance >= 55) {
      domPts = isBtc
        ? direction === "long"
          ? 3
          : -2
        : direction === "long"
          ? -4
          : 3;
      parts.push(`BTC dominance ${dominance.toFixed(1)}% high (${signed(domPts)})`);
    } else if (dominance <= 48) {
      domPts = isBtc
        ? direction === "long"
          ? -2
          : 2
        : direction === "long"
          ? 4
          : -3;
      parts.push(`BTC dominance ${dominance.toFixed(1)}% low (${signed(domPts)})`);
    } else {
      parts.push(`BTC dominance ${dominance.toFixed(1)}% mid-range (0)`);
    }
    points += domPts;
  }

  parts.push("DXY / NASDAQ / 10Y / ETF are not fetched (no official free API wired).");
  return {
    points: clamp(10 + points, 0, 20),
    reason: parts.join(" / "),
  };
}

function trendScore(
  tf: TimeframeIndicators | null,
  direction: "long" | "short",
  max: number,
): ScoreBreakdownItem {
  if (!tf) {
    return {
      key: `trend-${max}`,
      label: "Trend",
      points: 0,
      max,
      reason: "Timeframe indicators unavailable",
    };
  }
  let pts = 0;
  const notes: string[] = [];
  const bullStack =
    tf.ema20 != null && tf.ema50 != null && tf.ema200 != null && tf.ema20 > tf.ema50 && tf.ema50 > tf.ema200;
  const bearStack =
    tf.ema20 != null && tf.ema50 != null && tf.ema200 != null && tf.ema20 < tf.ema50 && tf.ema50 < tf.ema200;
  const stacked = direction === "long" ? bullStack : bearStack;
  if (stacked) {
    pts += Math.round(max * 0.4);
    notes.push("EMA20/50/200 stacked");
  } else {
    notes.push("EMA not stacked");
  }

  const structureHit =
    (direction === "long" && tf.structure === "HH_HL") ||
    (direction === "short" && tf.structure === "LH_LL");
  if (structureHit) {
    pts += Math.round(max * 0.2);
    notes.push(tf.structure);
  }

  const rsi = tf.rsi;
  if (rsi != null) {
    if (direction === "long" && rsi >= 50 && rsi <= 68) {
      pts += Math.round(max * 0.13);
      notes.push(`RSI ${rsi.toFixed(1)}`);
    } else if (direction === "short" && rsi <= 50 && rsi >= 32) {
      pts += Math.round(max * 0.13);
      notes.push(`RSI ${rsi.toFixed(1)}`);
    } else if (direction === "long" && rsi > 72) {
      notes.push("RSI overbought, no extra points");
    } else if (direction === "short" && rsi < 28) {
      notes.push("RSI oversold, no extra points");
    }
  }

  const macdHit =
    (direction === "long" && tf.macdBias === "Bullish") ||
    (direction === "short" && tf.macdBias === "Bearish");
  if (macdHit) {
    pts += Math.round(max * 0.13);
    notes.push(`MACD ${tf.macdBias}`);
  }

  if ((tf.adx ?? 0) >= 25) {
    pts += Math.round(max * 0.14);
    notes.push(`ADX ${(tf.adx ?? 0).toFixed(1)}`);
  }

  return {
    key: `trend-${tf.timeframe}`,
    label: `${tf.timeframe.toUpperCase()} trend`,
    points: clamp(pts, 0, max),
    max,
    reason: notes.join(" / "),
  };
}

function volumeScore(tf: TimeframeIndicators | null, direction: "long" | "short"): ScoreBreakdownItem {
  const ratio = tf?.volumeRatio;
  if (ratio == null || !tf) {
    return {
      key: "volume",
      label: "Volume",
      points: 0,
      max: 5,
      reason: "Volume ratio unavailable",
    };
  }
  const priceUp = (tf.ema20 ?? 0) >= (tf.ema50 ?? 0);
  const confirms =
    (direction === "long" && priceUp) || (direction === "short" && !priceUp);
  let points = 0;
  let bucket = "通常";
  if (ratio >= 1.5) {
    points = confirms ? 5 : 2;
    bucket = "強い";
  } else if (ratio >= 1.2) {
    points = confirms ? 3 : 1;
    bucket = "やや強い";
  } else if (ratio >= 0.8) {
    points = confirms ? 1 : 0;
    bucket = "通常";
  } else {
    points = 0;
    bucket = "弱い";
  }
  return {
    key: "volume",
    label: "Volume",
    points,
    max: 5,
    reason: `Volume ratio ${ratio.toFixed(2)} (${bucket})`,
  };
}

function momentumScore(tf15: TimeframeIndicators | null, direction: "long" | "short"): ScoreBreakdownItem {
  if (!tf15 || tf15.rsi == null) {
    return {
      key: "momentum",
      label: "Momentum",
      points: 0,
      max: 10,
      reason: "15M RSI/MACD unavailable",
    };
  }
  const aligned =
    (direction === "long" && tf15.rsi >= 50 && tf15.macdBias === "Bullish") ||
    (direction === "short" && tf15.rsi <= 50 && tf15.macdBias === "Bearish");
  return {
    key: "momentum",
    label: "Momentum",
    points: aligned ? 10 : 3,
    max: 10,
    reason: aligned
      ? `15M RSI ${tf15.rsi.toFixed(1)} and MACD ${tf15.macdBias} aligned`
      : `15M RSI ${tf15.rsi.toFixed(1)} / MACD ${tf15.macdBias} not aligned`,
  };
}

function priceActionScore(tf: TimeframeIndicators | null, direction: "long" | "short"): ScoreBreakdownItem {
  if (!tf) {
    return { key: "price-action", label: "Price action", points: 0, max: 10, reason: "unavailable" };
  }
  let pts = 0;
  const notes: string[] = [];
  const want = direction === "long" ? "HH_HL" : "LH_LL";
  if (tf.structure === want) {
    pts += 6;
    notes.push(tf.structure);
  }
  const wick = direction === "long" ? tf.lowerWick : tf.upperWick;
  if ((wick ?? 0) >= 0.4) {
    pts += 4;
    notes.push("rejection wick");
  }
  return {
    key: "price-action",
    label: "Price action",
    points: clamp(pts, 0, 10),
    max: 10,
    reason: notes.join(" / ") || "No structure edge",
  };
}

function btcAlignScore(
  btc4h: TimeframeIndicators | null,
  direction: "long" | "short",
): ScoreBreakdownItem {
  if (!btc4h) {
    return { key: "btc-align", label: "BTC alignment", points: 0, max: 5, reason: "BTC 4H unavailable" };
  }
  const bull = btc4h.trend === "Bullish" || btc4h.trend === "Strong Bullish";
  const bear = btc4h.trend === "Bearish" || btc4h.trend === "Strong Bearish";
  const hit = (direction === "long" && bull) || (direction === "short" && bear);
  return {
    key: "btc-align",
    label: "BTC alignment",
    points: hit ? 5 : 1,
    max: 5,
    reason: `BTC 4H ${btc4h.trend}`,
  };
}

export function scoreDirection(
  direction: "long" | "short",
  input: {
    market: MarketEnvInput;
    tf4h: TimeframeIndicators | null;
    tf1h: TimeframeIndicators | null;
    tf15m: TimeframeIndicators | null;
    futures?: import("@/lib/types/scoring").FuturesPositioning | null;
  },
) {
  const market = btcMarketPoints(input.market, direction);
  const t4 = trendScore(input.tf4h, direction, 15);
  const t1 = trendScore(input.tf1h, direction, 10);
  const t15 = trendScore(input.tf15m, direction, 5);
  const vol = volumeScore(input.tf15m ?? input.tf1h, direction);
  const mom = momentumScore(input.tf15m, direction);
  const pa = priceActionScore(input.tf1h ?? input.tf15m, direction);
  const btc = btcAlignScore(input.market.btc4h, direction);
  const pos = input.futures;
  const futuresAvailable = Boolean(pos?.availableOi || pos?.availableFunding);
  const futuresPts = direction === "long" ? (pos?.longPoints ?? 0) : (pos?.shortPoints ?? 0);
  const futuresItem: ScoreBreakdownItem = {
    key: "futures",
    label: "Futures positioning",
    points: futuresAvailable ? futuresPts : 0,
    max: 20,
    reason: futuresAvailable
      ? direction === "long"
        ? (pos?.longReason ?? "")
        : (pos?.shortReason ?? "")
      : "OI unavailable / Funding unavailable — this bucket excluded and other scores renormalized",
  };

  const marketItem: ScoreBreakdownItem = {
    key: "market",
    label: "Market environment",
    points: market.points,
    max: 20,
    reason: market.reason,
  };

  const items = [marketItem, t4, t1, t15, mom, vol, pa, btc, futuresItem];
  const core =
    marketItem.points + t4.points + t1.points + t15.points + mom.points + vol.points + pa.points + btc.points;
  const rawTotal = core + (futuresAvailable ? futuresItem.points : 0);
  const renormalized = !futuresAvailable;
  const total = clamp(Math.round(renormalized ? (core / 80) * 100 : rawTotal), 0, 100);

  return {
    total,
    renormalized,
    breakdown: {
      market: marketItem.points,
      trend4h: t4.points,
      trend1h: t1.points,
      trend15m: t15.points,
      momentum: mom.points,
      volume: vol.points,
      priceAction: pa.points,
      btcAlign: btc.points,
      futures: futuresAvailable ? futuresItem.points : 0,
    },
    items,
  };
}
