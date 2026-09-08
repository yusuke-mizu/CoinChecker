import type { SignalSetCandidate, TrackedSignal } from "@/lib/types/signals";

const TERMINAL = new Set(["EXPIRED", "INVALIDATED"]);

function band(value: number): "LOW" | "MEDIUM" | "HIGH" {
  if (value >= 70) return "HIGH";
  if (value >= 45) return "MEDIUM";
  return "LOW";
}

export function buildBalancedSignalSet(
  signals: TrackedSignal[],
  protectionCount: number,
): SignalSetCandidate | null {
  const eligible = signals
    .filter(
      (item) =>
        !TERMINAL.has(item.status) &&
        item.evaluationState === "AVAILABLE",
    )
    .sort(
      (a, b) =>
        b.current.dataQuality - a.current.dataQuality ||
        b.current.entry - a.current.entry,
    );
  const longs = eligible.filter((item) => item.direction === "LONG").slice(0, 2);
  const shorts = eligible.filter((item) => item.direction === "SHORT").slice(0, 2);
  const members = [...longs, ...shorts];
  if (members.length < 2) return null;

  const average = (values: number[]) =>
    values.reduce((sum, value) => sum + value, 0) / Math.max(values.length, 1);
  const takeProfit = average(members.map((item) => item.takeProfitScore));
  const exit = average(
    members.map((item) => Math.max(item.current.exitAlert, item.deteriorationScore)),
  );
  const highCorrelation = members.filter(
    (item) => Math.abs(item.current.btcCorrelation ?? 0) >= 0.8,
  ).length;
  const sameSide = Math.max(longs.length, shorts.length);
  const correlationRisk =
    highCorrelation >= 3 && sameSide >= 3
      ? "HIGH"
      : highCorrelation >= 2 && sameSide >= 2
        ? "MEDIUM"
        : "LOW";
  const protectionSignals = members.filter(
    (item) =>
      item.current.reversal >= 70 ||
      item.current.exitAlert >= 70 ||
      item.deteriorationScore >= 70,
  ).length;
  const exitRisk = band(exit);
  return {
    name: "BALANCED SET",
    members,
    status: exitRisk === "HIGH" ? "HIGH RISK" : exitRisk === "MEDIUM" ? "WATCH" : "ACTIVE",
    takeProfitRisk: band(takeProfit),
    exitRisk,
    correlationRisk,
    profitProtection: protectionSignals >= protectionCount,
  };
}
