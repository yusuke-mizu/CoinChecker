"use client";

import { useMemo } from "react";
import {
  summarizeSignalPerformance,
  summarizeSignalPerformanceByBand,
} from "@/lib/scoring/signal-performance";
import type { TrackedSignal } from "@/lib/types/signals";

export function SignalPerformancePanel({ signals }: { signals: TrackedSignal[] }) {
  const stats = useMemo(() => summarizeSignalPerformance(signals), [signals]);
  const bands = useMemo(() => summarizeSignalPerformanceByBand(signals), [signals]);
  return (
    <section className="rounded-lg border border-zinc-800 bg-zinc-900/70 p-4">
      <p className="text-[11px] tracking-[0.16em] text-zinc-500">HISTORICAL SIGNAL PERFORMANCE</p>
      <h2 className="mt-1 text-sm font-semibold text-zinc-100">スキャン時点の実測結果</h2>
      <p className="mt-1 text-[11px] text-zinc-500">
        THEORETICAL EXPECTED MOVEとは別です。期限後の最初のスキャンが許容時間内にある場合だけ記録します。
      </p>
      <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        {stats.map((stat) => (
          <div key={stat.horizon} className="rounded-md border border-zinc-800 bg-zinc-950 p-3 text-xs">
            <b>+{stat.horizon}</b>
            {stat.ready ? (
              <div className="mt-2 space-y-1 font-mono text-zinc-300">
                <p>Sample {stat.sampleSize} / {stat.maturity}</p>
                <p>Average {stat.averageReturnPct?.toFixed(2)}%</p>
                <p>Median {stat.medianReturnPct?.toFixed(2)}%</p>
                <p>Win Rate {stat.winRatePct?.toFixed(1)}%</p>
              </div>
            ) : (
              <p className="mt-2 text-zinc-500">
                Collecting samples: {stat.sampleSize}/30
                <br />Symbols {stat.distinctSymbols}/10 · Days {stat.distinctDays}/7
              </p>
            )}
          </div>
        ))}
      </div>
      {bands.length ? (
        <div className="mt-3 border-t border-zinc-800 pt-3">
          <p className="text-[11px] text-zinc-500">ENTRY SCORE帯別（5点幅）</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {bands.map((stat) => (
              <span key={`${stat.scoreBand}-${stat.horizon}`} className="rounded border border-zinc-800 px-2 py-1 text-[10px] text-zinc-400">
                {stat.scoreBand} / +{stat.horizon}:{" "}
                {stat.ready
                  ? `n=${stat.sampleSize} avg ${stat.averageReturnPct?.toFixed(2)}% median ${stat.medianReturnPct?.toFixed(2)}% win ${stat.winRatePct?.toFixed(1)}%`
                  : `Collecting ${stat.sampleSize}/30`}
              </span>
            ))}
          </div>
        </div>
      ) : null}
    </section>
  );
}
