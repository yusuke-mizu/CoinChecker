import type { SignalSetCandidate, TrackedSignal } from "@/lib/types/signals";

const TERMINAL = new Set(["EXPIRED", "INVALIDATED"]);

function band(value: number): "LOW" | "MEDIUM" | "HIGH" {
  if (value >= 70) return "HIGH";
  if (value >= 45) return "MEDIUM";
  return "LOW";
}

function average(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / Math.max(values.length, 1);
}

function aggregateSet(
  name: SignalSetCandidate["name"],
  members: TrackedSignal[],
  protectionCount: number,
  leverage: number,
): SignalSetCandidate | null {
  if (members.length < 2) return null;
  const longs = members.filter((item) => item.direction === "LONG");
  const shorts = members.filter((item) => item.direction === "SHORT");
  const expectedRewardPct = average(members.map((item) => item.current.potentialRewardPct));
  const expectedRiskPct = average(members.map((item) => item.current.potentialRiskPct));
  const rewardRisk = expectedRewardPct / Math.max(expectedRiskPct, 0.01);
  const reversalRisk = average(members.map((item) => item.current.reversal));
  const dataQuality = average(members.map((item) => item.current.dataQuality));
  const takeProfit = average(members.map((item) => item.takeProfitScore));
  const exit = average(
    members.map((item) => Math.max(item.current.exitAlert, item.deteriorationScore)),
  );
  const averageAbsCorrelation = average(
    members.map((item) => Math.abs(item.current.btcCorrelation ?? 0)),
  );
  const sameSide = Math.max(longs.length, shorts.length);
  const correlationRisk =
    averageAbsCorrelation >= 0.75 && sameSide >= 3
      ? "HIGH"
      : averageAbsCorrelation >= 0.6 && sameSide >= 2
        ? "MEDIUM"
        : "LOW";
  const protectionSignals = members.filter(
    (item) =>
      item.current.reversal >= 70 ||
      item.current.exitAlert >= 70 ||
      item.deteriorationScore >= 70,
  ).length;
  const exitRisk = band(exit);
  const longExposurePct = (longs.length / members.length) * 100;
  const shortExposurePct = (shorts.length / members.length) * 100;
  const netExposurePct = longExposurePct - shortExposurePct;
  const betas = members.filter((item) => item.current.btcBeta != null);
  const betaExposure = betas.length
    ? average(
        betas.map((item) =>
          (item.direction === "LONG" ? 1 : -1) * (item.current.btcBeta ?? 0),
        ),
      )
    : null;
  const stressEstimatedPct = betaExposure == null ? null : Math.abs(betaExposure * 5 * leverage);
  const stressLevel =
    stressEstimatedPct == null
      ? correlationRisk
      : stressEstimatedPct >= 7
        ? "HIGH"
        : stressEstimatedPct >= 3
          ? "MEDIUM"
          : "LOW";
  const baseScore = average(members.map((item) => item.current.entry));
  const setScore = Math.round(Math.max(
    0,
    Math.min(
      100,
      baseScore * 0.45 +
        Math.min(rewardRisk / 3, 1) * 100 * 0.25 +
        (100 - reversalRisk) * 0.15 +
        dataQuality * 0.15 -
        (leverage - 1) * 2 -
        (correlationRisk === "HIGH" ? 15 : correlationRisk === "MEDIUM" ? 7 : 0),
    ),
  ));
  return {
    name,
    members,
    status: exitRisk === "HIGH" ? "HIGH RISK" : exitRisk === "MEDIUM" ? "WATCH" : "ACTIVE",
    takeProfitRisk: band(takeProfit),
    exitRisk,
    correlationRisk,
    profitProtection: protectionSignals >= protectionCount,
    expectedRewardPct,
    expectedRiskPct,
    rewardRisk,
    longExposurePct,
    shortExposurePct,
    netExposurePct,
    reversalRisk,
    dataQuality,
    setScore,
    stressLevel,
    stressEstimatedPct,
    leverage,
  };
}

function eligibleSignals(signals: TrackedSignal[]): TrackedSignal[] {
  return signals.filter(
    (item) =>
      !TERMINAL.has(item.status) &&
      item.evaluationState === "AVAILABLE" &&
      item.current.scoreModel === "expectancy-v1" &&
      item.current.rewardRisk >= 1,
  );
}

export function buildBalancedSignalSet(
  signals: TrackedSignal[],
  protectionCount: number,
  leverage = 1,
): SignalSetCandidate | null {
  const eligible = eligibleSignals(signals)
    .sort(
      (a, b) =>
        b.current.dataQuality - a.current.dataQuality ||
        b.current.entry - a.current.entry,
    );
  const longs = eligible.filter((item) => item.direction === "LONG").slice(0, 2);
  const shorts = eligible.filter((item) => item.direction === "SHORT").slice(0, 2);
  const members = [...longs, ...shorts];
  return aggregateSet("BALANCED SET", members, protectionCount, leverage);
}

export function buildExpectedValueSets(
  signals: TrackedSignal[],
  protectionCount: number,
  leverage = 1,
): SignalSetCandidate[] {
  const eligible = eligibleSignals(signals);
  const profit = [...eligible]
    .sort(
      (a, b) =>
        b.current.expectedMove - a.current.expectedMove ||
        b.current.entry - a.current.entry,
    )
    .slice(0, 4);
  const defensive = [...eligible]
    .filter((item) => item.current.rewardRisk >= 1.5)
    .sort(
      (a, b) =>
        a.current.potentialRiskPct - b.current.potentialRiskPct ||
        a.current.reversal - b.current.reversal ||
        b.current.dataQuality - a.current.dataQuality,
    )
    .slice(0, 4);
  return [
    aggregateSet("PROFIT SET", profit, protectionCount, leverage),
    buildBalancedSignalSet(signals, protectionCount, leverage),
    aggregateSet("DEFENSIVE SET", defensive, protectionCount, leverage),
  ].filter((item): item is SignalSetCandidate => item != null);
}
