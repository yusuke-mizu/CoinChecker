"use client";

import { useCallback, useRef, useState } from "react";
import { HistogramBars, LineChart } from "./charts";
import { DEFAULT_MONTE_CARLO, runMonteCarlo } from "@/lib/simulation/monte-carlo";
import { MONTE_CARLO_PATH_OPTIONS } from "@/lib/simulation/settings";
import type { MonteCarloResult, MonteCarloSettings, TradePopulation } from "@/lib/types/simulation";

function yen(value: number): string {
  return `¥${Math.round(value).toLocaleString("ja-JP")}`;
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="rounded border border-zinc-800 bg-zinc-950/70 p-2">
      <p className="text-[10px] tracking-[0.12em] text-zinc-500">{label}</p>
      <p className={`mt-1 font-mono text-sm ${tone ?? "text-zinc-100"}`}>{value}</p>
    </div>
  );
}

const numberInput =
  "mt-1 w-full rounded border border-zinc-700 bg-zinc-950 px-2 py-1 font-mono text-xs text-zinc-100 outline-none focus:border-cyan-600";

export function MonteCarloPanel({
  population,
  initialCapital,
  riskPerTradePct,
  compounding,
}: {
  population: TradePopulation | null;
  initialCapital: number;
  riskPerTradePct: number;
  compounding: boolean;
}) {
  const [settings, setSettings] = useState<MonteCarloSettings>({
    ...DEFAULT_MONTE_CARLO,
    initialCapital,
    riskPerTradePct,
    compounding,
  });
  const [result, setResult] = useState<MonteCarloResult | null>(null);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const runningRef = useRef(false);

  const patch = (partial: Partial<MonteCarloSettings>) =>
    setSettings((previous) => ({ ...previous, ...partial }));

  const run = useCallback(
    async (paths: number) => {
      if (runningRef.current || !population) return;
      runningRef.current = true;
      setError(null);
      setProgress({ done: 0, total: paths });
      try {
        const next = { ...settings, paths, initialCapital, riskPerTradePct, compounding };
        setSettings(next);
        const outcome = await runMonteCarlo(population, next, (done, total) =>
          setProgress({ done, total }),
        );
        setResult(outcome);
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : String(caught));
      } finally {
        runningRef.current = false;
        setProgress(null);
      }
    },
    [population, settings, initialCapital, riskPerTradePct, compounding],
  );

  const disabled = !population || population.rMultiples.length === 0;

  return (
    <section className="space-y-3">
      <div className="rounded-lg border border-zinc-800 bg-zinc-900/60 p-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-sm font-semibold tracking-[0.14em] text-zinc-300">
            MONTE CARLO SIMULATION
          </h2>
          <p className="text-[11px] text-zinc-500">
            {disabled
              ? "先にBacktestを実行してください。"
              : `Trade母集団 ${population!.rMultiples.length} 件をリサンプリング`}
          </p>
        </div>

        <div className="mt-3 grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <label className="text-xs">
            <span className="text-zinc-400">Trades / Path</span>
            <input
              type="number"
              className={numberInput}
              min={20}
              max={2000}
              step={10}
              value={settings.tradesPerPath}
              onChange={(event) => patch({ tradesPerPath: Number(event.target.value) })}
            />
          </label>
          <label className="text-xs">
            <span className="text-zinc-400">Block Size</span>
            <input
              type="number"
              className={numberInput}
              min={1}
              max={50}
              value={settings.blockSize}
              onChange={(event) => patch({ blockSize: Number(event.target.value) })}
            />
            <span className="mt-1 block text-[10px] text-zinc-600">
              1でiid、2以上で連勝連敗を保持
            </span>
          </label>
          <label className="text-xs">
            <span className="text-zinc-400">Ruin Threshold (%)</span>
            <input
              type="number"
              className={numberInput}
              min={1}
              max={90}
              value={settings.ruinThresholdPct}
              onChange={(event) => patch({ ruinThresholdPct: Number(event.target.value) })}
            />
          </label>
          <label className="text-xs">
            <span className="text-zinc-400">Drawdown Threshold (%)</span>
            <input
              type="number"
              className={numberInput}
              min={5}
              max={95}
              value={settings.drawdownThresholdPct}
              onChange={(event) => patch({ drawdownThresholdPct: Number(event.target.value) })}
            />
          </label>
          <label className="text-xs">
            <span className="text-zinc-400">Target Capital (JPY)</span>
            <input
              type="number"
              className={numberInput}
              min={initialCapital}
              step={10_000}
              value={settings.targetCapital}
              onChange={(event) => patch({ targetCapital: Number(event.target.value) })}
            />
          </label>
          <label className="text-xs">
            <span className="text-zinc-400">Seed</span>
            <input
              type="number"
              className={numberInput}
              value={settings.seed}
              onChange={(event) => patch({ seed: Number(event.target.value) })}
            />
            <span className="mt-1 block text-[10px] text-zinc-600">同じSeedで再現します</span>
          </label>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          {MONTE_CARLO_PATH_OPTIONS.map((paths) => (
            <button
              key={paths}
              type="button"
              disabled={disabled || progress != null}
              onClick={() => void run(paths)}
              className="rounded border border-cyan-700 bg-cyan-950/40 px-3 py-1.5 text-xs font-semibold text-cyan-100 hover:bg-cyan-900/40 disabled:opacity-40"
            >
              RUN {paths.toLocaleString("en-US")} SIMULATIONS
            </button>
          ))}
          {progress ? (
            <span className="text-xs text-zinc-400">
              {progress.done.toLocaleString()} / {progress.total.toLocaleString()} paths
            </span>
          ) : null}
        </div>

        <p className="mt-2 text-[11px] text-zinc-500">
          各pathは実測Trade結果をブロック単位でリサンプリングし、Risk per Trade{" "}
          {riskPerTradePct}% でR倍数を複利適用します。同じデータを1000回コピーするのではなく、
          異なる順序・異なる連勝連敗の並びを生成しています。
        </p>
        {error ? <p className="mt-2 text-xs text-rose-300">{error}</p> : null}
      </div>

      {result ? (
        <>
          <div className="rounded-lg border border-zinc-800 bg-zinc-900/60 p-4">
            <h3 className="text-xs tracking-[0.14em] text-zinc-500">
              DISTRIBUTION OF {result.settings.paths.toLocaleString()} PATHS
            </h3>
            <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-6">
              <Stat label="MEDIAN FINAL" value={yen(result.medianFinalCapital)} />
              <Stat label="MEAN FINAL" value={yen(result.meanFinalCapital)} />
              <Stat label="BEST CASE" value={yen(result.bestCase)} tone="text-emerald-300" />
              <Stat label="WORST CASE" value={yen(result.worstCase)} tone="text-rose-300" />
              <Stat label="5th PERCENTILE" value={yen(result.percentiles.p5)} />
              <Stat label="25th PERCENTILE" value={yen(result.percentiles.p25)} />
              <Stat label="50th PERCENTILE" value={yen(result.percentiles.p50)} />
              <Stat label="75th PERCENTILE" value={yen(result.percentiles.p75)} />
              <Stat label="95th PERCENTILE" value={yen(result.percentiles.p95)} />
              <Stat
                label="PROBABILITY OF LOSS"
                value={`${result.probabilityOfLoss.toFixed(1)}%`}
                tone="text-amber-300"
              />
              <Stat
                label={`P(DD > ${result.settings.drawdownThresholdPct}%)`}
                value={`${result.probabilityOfDrawdownBeyondThreshold.toFixed(1)}%`}
                tone="text-amber-300"
              />
              <Stat
                label="PROBABILITY OF RUIN"
                value={`${result.probabilityOfRuin.toFixed(1)}%`}
                tone={result.probabilityOfRuin > 5 ? "text-rose-300" : "text-zinc-100"}
              />
              <Stat
                label="MEDIAN MAX DD"
                value={`-${result.medianMaxDrawdownPct.toFixed(1)}%`}
                tone="text-rose-300"
              />
              <Stat
                label="WORST MAX DD"
                value={`-${result.worstMaxDrawdownPct.toFixed(1)}%`}
                tone="text-rose-300"
              />
            </div>
          </div>

          <div className="rounded-lg border border-zinc-800 bg-zinc-900/60 p-4">
            <h3 className="text-xs tracking-[0.14em] text-zinc-500">
              TARGET {yen(result.settings.initialCapital)} → {yen(result.settings.targetCapital)}
            </h3>
            <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
              <Stat
                label="TARGET REACH PROBABILITY"
                value={`${result.targetReachProbability.toFixed(2)}%`}
                tone={result.targetReachProbability > 0 ? "text-amber-300" : "text-zinc-400"}
              />
              <Stat
                label="MEDIAN TRADES TO TARGET"
                value={
                  result.medianTradesToTarget == null
                    ? "到達なし"
                    : `${Math.round(result.medianTradesToTarget)} trades`
                }
              />
              <Stat
                label="MEDIAN TIME TO TARGET"
                value={
                  result.medianDaysToTarget == null
                    ? "到達なし"
                    : `${result.medianDaysToTarget.toFixed(1)} days`
                }
              />
              <Stat label="BEST CASE" value={yen(result.bestCase)} />
              <Stat label="WORST CASE" value={yen(result.worstCase)} tone="text-rose-300" />
              <Stat
                label="PROBABILITY OF RUIN"
                value={`${result.probabilityOfRuin.toFixed(1)}%`}
                tone={result.probabilityOfRuin > 5 ? "text-rose-300" : "text-zinc-100"}
              />
            </div>
            <p className="mt-3 text-[11px] leading-5 text-zinc-500">
              到達確率は「達成可能」を意味しません。同じ分布から、破産・大幅ドローダウンで終わるpathも
              同時に発生します。到達したpathだけを取り出して評価しないでください。
            </p>
          </div>

          <div className="grid gap-3 lg:grid-cols-2">
            <LineChart
              values={result.medianPathCurve}
              label="Median Path Equity (log scale)"
              logScale
              baseline={result.settings.initialCapital}
              color="#22d3ee"
            />
            <HistogramBars
              buckets={result.finalCapitalHistogram}
              label="Final Capital Distribution (× initial)"
            />
          </div>
        </>
      ) : null}
    </section>
  );
}
