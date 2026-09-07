import type { FuturesPositioning, TimeframeIndicators } from "@/lib/types/scoring";
import type { RegimeSnapshot } from "@/lib/scoring/regime";

export type TimingLabel =
  | "STRONG ENTRY WINDOW"
  | "GOOD ENTRY WINDOW"
  | "WAIT / NEUTRAL"
  | "POOR TIMING"
  | "NO ENTRY";

export type TimingAssessment = {
  long: number;
  short: number;
  side: "long" | "short";
  score: number;
  label: TimingLabel;
  waitReasons: string[];
  items: Array<{ key: string; points: number; max: number; reason: string }>;
};

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

function tfBlock(tf: TimeframeIndicators | null, direction: "long" | "short", max: number) {
  if (!tf) return { points: 0, reason: "足不足" };
  let pts = 0;
  const notes: string[] = [];
  const bull = tf.trend === "Bullish" || tf.trend === "Strong Bullish";
  const bear = tf.trend === "Bearish" || tf.trend === "Strong Bearish";
  if ((direction === "long" && bull) || (direction === "short" && bear)) {
    pts += Math.round(max * 0.28);
    notes.push(tf.trend);
  }
  const emaOk =
    tf.ema20 != null &&
    tf.lastClose != null &&
    ((direction === "long" && tf.lastClose >= tf.ema20) ||
      (direction === "short" && tf.lastClose <= tf.ema20));
  if (emaOk) {
    pts += Math.round(max * 0.18);
    notes.push("EMA20側");
  }
  if (
    (direction === "long" && tf.macdBias === "Bullish") ||
    (direction === "short" && tf.macdBias === "Bearish")
  ) {
    pts += Math.round(max * 0.18);
    notes.push("MACD一致");
  }
  if (tf.rsi != null) {
    if (direction === "long" && tf.rsi >= 72) notes.push("RSI過熱");
    else if (direction === "short" && tf.rsi <= 28) notes.push("RSI売られ過ぎ");
    else if (direction === "long" && tf.rsi >= 48 && tf.rsi <= 68) pts += Math.round(max * 0.16);
    else if (direction === "short" && tf.rsi <= 52 && tf.rsi >= 32) pts += Math.round(max * 0.16);
  }
  if ((tf.volumeRatio ?? 0) >= 1.2) {
    pts += Math.round(max * 0.12);
    notes.push("出来高あり");
  } else if ((tf.volumeRatio ?? 1) < 0.8) {
    notes.push("出来高減少");
  }
  if ((direction === "long" && tf.structure === "HH_HL") || (direction === "short" && tf.structure === "LH_LL")) {
    pts += Math.round(max * 0.08);
  }
  return { points: clamp(pts, 0, max), reason: notes.join(" / ") || "材料弱め" };
}

function contextBlock(
  regime: RegimeSnapshot,
  btc4h: TimeframeIndicators | null,
  corr: number | null,
  direction: "long" | "short",
): { points: number; reason: string } {
  let pts = 8;
  const notes: string[] = [`Regime ${regime.regime}`];
  if (regime.regime === "RANGING" && !regime.breakout) {
    pts -= 8;
    notes.push("レンジは新規抑制");
  }
  if (regime.regime === "TRENDING" || regime.breakout) pts += 4;
  const bull = btc4h?.trend === "Bullish" || btc4h?.trend === "Strong Bullish";
  const bear = btc4h?.trend === "Bearish" || btc4h?.trend === "Strong Bearish";
  if ((direction === "long" && bull) || (direction === "short" && bear)) pts += 5;
  else if ((direction === "long" && bear) || (direction === "short" && bull)) pts -= 4;
  if (corr != null && Math.abs(corr) >= 0.8) {
    pts -= 2;
    notes.push("BTC高相関");
  }
  return { points: clamp(pts, 0, 20), reason: notes.join(" / ") };
}

function futuresBlock(futures: FuturesPositioning | null, direction: "long" | "short") {
  if (!futures || (!futures.availableOi && !futures.availableFunding)) {
    return { points: 0, reason: "OI/Funding欠落" };
  }
  const pts = direction === "long" ? futures.longPoints : futures.shortPoints;
  return { points: clamp(pts, 0, 20), reason: direction === "long" ? futures.longReason : futures.shortReason };
}

function labelFor(score: number): TimingLabel {
  if (score >= 80) return "STRONG ENTRY WINDOW";
  if (score >= 70) return "GOOD ENTRY WINDOW";
  if (score >= 50) return "WAIT / NEUTRAL";
  if (score >= 30) return "POOR TIMING";
  return "NO ENTRY";
}

export function scoreEntryTiming(input: {
  tf4h: TimeframeIndicators | null;
  tf1h: TimeframeIndicators | null;
  tf15m: TimeframeIndicators | null;
  btc4h: TimeframeIndicators | null;
  futures: FuturesPositioning | null;
  regime: RegimeSnapshot;
  btcCorrelation: number | null;
  side: "long" | "short";
}): TimingAssessment {
  const long15 = tfBlock(input.tf15m, "long", 30);
  const long1h = tfBlock(input.tf1h, "long", 30);
  const longCtx = contextBlock(input.regime, input.btc4h, input.btcCorrelation, "long");
  const longFut = futuresBlock(input.futures, "long");
  const short15 = tfBlock(input.tf15m, "short", 30);
  const short1h = tfBlock(input.tf1h, "short", 30);
  const shortCtx = contextBlock(input.regime, input.btc4h, input.btcCorrelation, "short");
  const shortFut = futuresBlock(input.futures, "short");

  const long = clamp(long15.points + long1h.points + longCtx.points + longFut.points, 0, 100);
  const short = clamp(short15.points + short1h.points + shortCtx.points + shortFut.points, 0, 100);
  const side = input.side;
  const score = side === "long" ? long : short;
  const waitReasons: string[] = [];
  if ((input.tf15m?.rsi ?? 50) >= 72 && side === "long") waitReasons.push("15M RSI過熱");
  if ((input.tf15m?.rsi ?? 50) <= 28 && side === "short") waitReasons.push("15M RSI売られ過ぎ");
  if ((input.tf15m?.volumeRatio ?? 1) < 0.85) waitReasons.push("出来高減少");
  if (input.regime.regime === "RANGING" && !input.regime.breakout) waitReasons.push("レンジ — 新規見送り寄り");
  if ((input.futures?.fundingPercentile ?? 50) >= 90 && side === "long") waitReasons.push("Funding上昇（買い過密）");
  if (input.tf15m?.macdBias === (side === "long" ? "Bearish" : "Bullish")) {
    waitReasons.push("短期モメンタムが弱い");
  }
  if (score >= 70) waitReasons.length = 0;

  const pack = side === "long" ? [long15, long1h, longCtx, longFut] : [short15, short1h, shortCtx, shortFut];
  return {
    long,
    short,
    side,
    score,
    label: labelFor(score),
    waitReasons,
    items: [
      { key: "15m", points: pack[0].points, max: 30, reason: pack[0].reason },
      { key: "1h", points: pack[1].points, max: 30, reason: pack[1].reason },
      { key: "context", points: pack[2].points, max: 20, reason: pack[2].reason },
      { key: "futures", points: pack[3].points, max: 20, reason: pack[3].reason },
    ],
  };
}
