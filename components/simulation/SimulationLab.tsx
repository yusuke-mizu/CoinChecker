"use client";

import { useCallback, useRef, useState } from "react";
import Link from "next/link";
import { MonteCarloPanel } from "./MonteCarloPanel";
import { SimulationResults } from "./SimulationResults";
import { SimulationSettingsForm } from "./SimulationSettingsForm";
import { DEFAULT_SIMULATION_SETTINGS } from "@/lib/simulation/settings";
import { readApiJson } from "@/lib/client/api-json";
import type { BacktestResult, SimulationSettings } from "@/lib/types/simulation";

export function SimulationLab() {
  const [settings, setSettings] = useState<SimulationSettings>(DEFAULT_SIMULATION_SETTINGS);
  const [result, setResult] = useState<BacktestResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const runningRef = useRef(false);

  const runBacktest = useCallback(async () => {
    if (runningRef.current) return;
    runningRef.current = true;
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/simulation/backtest", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ settings }),
      });
      const json = await readApiJson<BacktestResult & { error?: string }>(
        response,
        "POST /api/simulation/backtest",
      );
      if (!response.ok) throw new Error(json.error || "Backtestに失敗しました");
      setResult(json);
      // Server-side clamping is authoritative; reflect it so the form matches the run.
      setSettings(json.settings);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      runningRef.current = false;
      setLoading(false);
    }
  }, [settings]);

  return (
    <main className="mx-auto max-w-7xl space-y-4 p-4 sm:p-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold">Trading Research &amp; Simulation</h1>
          <p className="mt-1 text-xs text-zinc-500">
            仮説を過去データで検証するための研究環境です。自動売買・自動注文は行いません。
            バックテスト結果は将来の成績を保証しません。
          </p>
        </div>
        <Link
          href="/"
          className="rounded border border-zinc-700 px-3 py-1.5 text-xs text-zinc-300 hover:border-zinc-500"
        >
          ← Dashboardへ戻る
        </Link>
      </header>

      <section className="rounded-lg border border-zinc-800 bg-zinc-900/60 p-4">
        <h2 className="text-sm font-semibold tracking-[0.14em] text-zinc-300">
          SIMULATION SETTINGS
        </h2>
        <div className="mt-3">
          <SimulationSettingsForm
            settings={settings}
            disabled={loading}
            onChange={setSettings}
          />
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={() => void runBacktest()}
            disabled={loading}
            className="rounded border border-emerald-700 bg-emerald-950/40 px-4 py-2 text-xs font-semibold text-emerald-100 hover:bg-emerald-900/40 disabled:opacity-40"
          >
            {loading ? "RUNNING HISTORICAL BACKTEST…" : "RUN HISTORICAL BACKTEST"}
          </button>
          <span className="text-[11px] text-zinc-500">
            各銘柄・各時間足について1リクエストずつ取得し、指標は一度だけ計算して全戦略で再利用します。
          </span>
        </div>
        {error ? <p className="mt-3 text-xs text-rose-300">{error}</p> : null}
      </section>

      {result ? <SimulationResults result={result} /> : null}

      <MonteCarloPanel
        population={result?.population ?? null}
        initialCapital={settings.initialCapital}
        riskPerTradePct={settings.riskPerTradePct}
        compounding={settings.compounding}
      />
    </main>
  );
}
