"use client";

import { useMemo } from "react";
import { buildExpectedValueSets } from "@/lib/scoring/signal-sets";
import type { SignalSettings, TrackedSignal } from "@/lib/types/signals";

export function ExpectedValueSetsPanel({
  signals,
  settings,
}: {
  signals: TrackedSignal[];
  settings: SignalSettings;
}) {
  const sets = useMemo(
    () => buildExpectedValueSets(signals, settings.portfolioProtectionCount, settings.setLeverage),
    [signals, settings.portfolioProtectionCount, settings.setLeverage],
  );
  return (
    <section className="rounded-lg border border-zinc-800 bg-zinc-900/70 p-4">
      <p className="text-[11px] tracking-[0.16em] text-zinc-500">SETS</p>
      <h2 className="mt-1 text-sm font-semibold text-zinc-100">Expected Value セット候補</h2>
      <p className="mt-1 text-[11px] text-zinc-500">
        等ウェイトの理論比較です。CorrelationはBTC factor、StressはBTC -5%時のBeta概算であり損失予測ではありません。
      </p>
      {sets.length ? (
        <div className="mt-3 grid gap-2 lg:grid-cols-3">
          {sets.map((set) => (
            <div key={set.name} className="rounded-md border border-zinc-700 bg-zinc-950 p-3 text-xs">
              <div className="flex items-center justify-between gap-2">
                <b>{set.name}</b>
                <span>SET SCORE {set.setScore}</span>
              </div>
              <p className="mt-2 text-zinc-400">
                {set.members.map((item) => `${item.symbol} ${item.direction}`).join(" / ")}
              </p>
              <p className="mt-1 text-zinc-400">
                THEORETICAL MOVE +{set.expectedRewardPct.toFixed(2)}% / -{set.expectedRiskPct.toFixed(2)}%
                {" "}· R/R {set.rewardRisk.toFixed(2)}
              </p>
              <p className="mt-1 text-zinc-400">
                LONG {set.longExposurePct.toFixed(0)}% · SHORT {set.shortExposurePct.toFixed(0)}%
                {" "}· NET {set.netExposurePct >= 0 ? "+" : ""}{set.netExposurePct.toFixed(0)}%
              </p>
              <p className="mt-1 text-zinc-400">
                CORRELATION {set.correlationRisk} · REVERSAL {set.reversalRisk.toFixed(0)}
                {" "}· BTC -5% STRESS {set.stressLevel}
                {set.stressEstimatedPct == null ? "" : ` (~${set.stressEstimatedPct.toFixed(1)}%)`}
                {" "}· QUALITY {set.dataQuality.toFixed(0)} · {set.leverage}x Risk
              </p>
              <p className="mt-1 text-zinc-400">
                EFFECTIVE DIVERSIFICATION {set.effectiveDiversification.toFixed(1)}/{set.members.length}
                {" "}· RISK BUDGET {set.riskBudgetScore}/100
                {" "}· COMPOUNDING {set.compoundingQuality}/100
              </p>
              {set.alerts.map((alert) => (
                <p key={alert} className="mt-2 font-semibold text-amber-300">{alert}</p>
              ))}
              {set.profitProtection ? (
                <p className="mt-2 font-semibold text-amber-300">PORTFOLIO PROFIT PROTECTION / 利益保護を検討</p>
              ) : null}
            </div>
          ))}
        </div>
      ) : (
        <p className="mt-3 text-xs text-zinc-500">セット条件を満たす高期待値Signalが不足しています。</p>
      )}
    </section>
  );
}
