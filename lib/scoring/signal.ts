import type { DirectionScore, SignalLabel, BiasLabel } from "@/lib/types/scoring";

export function classifySignal(
  long: DirectionScore,
  short: DirectionScore,
): { signal: SignalLabel; bias: BiasLabel; difference: number } {
  const difference = long.total - short.total;
  const abs = Math.abs(difference);

  if (long.total >= 60 && short.total >= 60 && abs < 15) {
    return {
      signal: "CONFLICT / NO SIGNAL",
      bias: "方向感なし / 見送り",
      difference,
    };
  }

  const primary = difference >= 0 ? long.total : short.total;
  const side = difference >= 0 ? "LONG" : "SHORT";

  if (abs < 12 && primary < 70) {
    return {
      signal: "NO SIGNAL",
      bias: "方向感なし / 見送り",
      difference,
    };
  }

  const bias: BiasLabel = difference > 12 ? "LONG優勢" : difference < -12 ? "SHORT優勢" : "方向感なし / 見送り";

  let strength: SignalLabel = "NO SIGNAL";
  if (primary >= 80) {
    strength = side === "LONG" ? "VERY STRONG LONG CANDIDATE" : "VERY STRONG SHORT CANDIDATE";
  } else if (primary >= 70) {
    strength = side === "LONG" ? "STRONG LONG CANDIDATE" : "STRONG SHORT CANDIDATE";
  } else if (primary >= 60) {
    strength = side === "LONG" ? "LONG CANDIDATE" : "SHORT CANDIDATE";
  } else if (primary >= 40) {
    strength = side === "LONG" ? "WATCH LONG" : "WATCH SHORT";
  } else {
    strength = "NO SIGNAL";
  }

  return { signal: strength, bias, difference };
}
