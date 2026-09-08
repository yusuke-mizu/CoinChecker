import type {
  SignalPerformanceHorizon,
  TrackedSignal,
} from "@/lib/types/signals";

export type SignalPerformanceStat = {
  horizon: SignalPerformanceHorizon;
  sampleSize: number;
  distinctSymbols: number;
  distinctDays: number;
  ready: boolean;
  maturity: "COLLECTING" | "PRELIMINARY" | "ESTABLISHED";
  averageReturnPct: number | null;
  medianReturnPct: number | null;
  winRatePct: number | null;
};

const HORIZONS: SignalPerformanceHorizon[] = ["1h", "4h", "12h", "24h"];

export function summarizeSignalPerformance(
  signals: TrackedSignal[],
): SignalPerformanceStat[] {
  return HORIZONS.map((horizon) => {
    const samples = signals.flatMap((signal) => {
      const checkpoint = signal.performance?.find((item) => item.horizon === horizon);
      return checkpoint?.state === "OBSERVED" && checkpoint.returnPct != null
        ? [{ signal, value: checkpoint.returnPct }]
        : [];
    });
    const values = samples.map((sample) => sample.value).sort((a, b) => a - b);
    const distinctSymbols = new Set(samples.map((sample) => sample.signal.symbol)).size;
    const distinctDays = new Set(
      samples.map((sample) => sample.signal.createdAt.slice(0, 10)),
    ).size;
    const ready = values.length >= 30 && distinctSymbols >= 10 && distinctDays >= 7;
    const average = values.reduce((sum, value) => sum + value, 0) / Math.max(values.length, 1);
    const middle = Math.floor(values.length / 2);
    const median = values.length
      ? values.length % 2
        ? values[middle]
        : (values[middle - 1] + values[middle]) / 2
      : 0;
    return {
      horizon,
      sampleSize: values.length,
      distinctSymbols,
      distinctDays,
      ready,
      maturity: !ready ? "COLLECTING" : values.length >= 100 ? "ESTABLISHED" : "PRELIMINARY",
      averageReturnPct: ready ? average : null,
      medianReturnPct: ready ? median : null,
      winRatePct: ready
        ? (values.filter((value) => value > 0).length / values.length) * 100
        : null,
    };
  });
}

export function summarizeSignalPerformanceByBand(
  signals: TrackedSignal[],
): Array<SignalPerformanceStat & { scoreBand: string }> {
  const groups = new Map<string, TrackedSignal[]>();
  for (const signal of signals) {
    if (signal.baseline.scoreModel !== "expectancy-v1") continue;
    const floor = Math.floor(signal.baseline.entry / 5) * 5;
    const scoreBand = `${floor}-${Math.min(100, floor + 4)}`;
    const list = groups.get(scoreBand) ?? [];
    list.push(signal);
    groups.set(scoreBand, list);
  }
  return [...groups.entries()]
    .flatMap(([scoreBand, rows]) =>
      summarizeSignalPerformance(rows).map((stat) => ({ ...stat, scoreBand })),
    )
    .filter((stat) => stat.sampleSize > 0)
    .sort((a, b) => b.scoreBand.localeCompare(a.scoreBand) || a.horizon.localeCompare(b.horizon));
}
