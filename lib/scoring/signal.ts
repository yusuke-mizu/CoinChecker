import type { DirectionScore, SignalLabel, BiasLabel, ReversalAssessment } from "@/lib/types/scoring";

export function classifySignal(
  long: DirectionScore,
  short: DirectionScore,
  reversal?: ReversalAssessment | null,
): { signal: SignalLabel; bias: BiasLabel; difference: number } {
  const difference = long.total - short.total;
  const abs = Math.abs(difference);
  const trendStrength = (s: DirectionScore) => s.breakdown.trend4h + s.breakdown.trend1h;

  if (long.total >= 60 && short.total >= 60 && abs < 15) {
    return {
      signal: "CONFLICT / NO SIGNAL",
      bias: "方向感なし / 見送り",
      difference,
    };
  }

  const primary = difference >= 0 ? long : short;
  const side = difference >= 0 ? "LONG" : "SHORT";
  const weakTrend = trendStrength(primary) < 12;
  const strongRev =
    reversal != null && (reversal.bullish >= 80 || reversal.bearish >= 80);

  if (weakTrend && strongRev && primary.breakdown.futures >= 12) {
    return {
      signal: "SHORT-TERM REVERSAL CANDIDATE",
      bias: "方向感なし / 見送り",
      difference,
    };
  }

  if (abs < 12 && primary.total < 70) {
    return {
      signal: "NO SIGNAL",
      bias: "方向感なし / 見送り",
      difference,
    };
  }

  const bias: BiasLabel = difference > 12 ? "LONG優勢" : difference < -12 ? "SHORT優勢" : "方向感なし / 見送り";

  let strength: SignalLabel = "NO SIGNAL";
  if (primary.total >= 80) {
    strength = side === "LONG" ? "VERY STRONG LONG CANDIDATE" : "VERY STRONG SHORT CANDIDATE";
  } else if (primary.total >= 70) {
    strength = side === "LONG" ? "STRONG LONG CANDIDATE" : "STRONG SHORT CANDIDATE";
  } else if (primary.total >= 60) {
    strength = side === "LONG" ? "LONG CANDIDATE" : "SHORT CANDIDATE";
  } else if (primary.total >= 40) {
    strength = side === "LONG" ? "WATCH LONG" : "WATCH SHORT";
  }

  return { signal: strength, bias, difference };
}
