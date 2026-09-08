"use client";

import { dominantDirection } from "@/lib/scoring/signal-tracking";
import type { SymbolAnalysis } from "@/lib/types/scoring";
import type { SignalSettings } from "@/lib/types/signals";

export function NewEntryPanel({
  rows,
  settings,
  onSelect,
}: {
  rows: SymbolAnalysis[];
  settings: SignalSettings;
  onSelect: (row: SymbolAnalysis) => void;
}) {
  const entries = rows
    .flatMap((row) => {
      const direction = dominantDirection(row);
      if (!direction || row.regime?.regime === "RANGING") return [];
      const assessment =
        direction === "LONG" ? row.entryExpectancy.long : row.entryExpectancy.short;
      const plan = direction === "LONG" ? row.tradePlans.long : row.tradePlans.short;
      if (!assessment || !plan) return [];
      const entry = assessment?.total;
      const timing = assessment?.timingScore;
      if (
        entry == null ||
        timing == null ||
        entry < settings.watchEntryThreshold
      ) return [];
      const configuredDecision =
        plan.entryVerdict === "ENTRY NOW" &&
        (entry < settings.strongEntryThreshold || timing < settings.timingThreshold)
          ? "ENTRY WATCH"
          : plan.entryVerdict;
      return [{ row, direction, entry, timing, assessment, plan, configuredDecision }];
    })
    .sort((a, b) => b.entry - a.entry || b.timing - a.timing)
    .slice(0, settings.topN ?? undefined);

  return (
    <section className="rounded-lg border border-zinc-800 bg-zinc-900/70 p-4">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <p className="text-[11px] tracking-[0.16em] text-zinc-500">NEW ENTRY</p>
          <h2 className="mt-1 text-sm font-semibold text-zinc-100">現在の新規エントリー候補</h2>
        </div>
        <p className="text-[11px] text-zinc-500">
          STRONG {settings.strongEntryThreshold}+ / WATCH {settings.watchEntryThreshold}+ / RANGE除外
        </p>
      </div>
      <div className="mt-3 grid gap-2 md:grid-cols-2 xl:grid-cols-3">
        {entries.length ? entries.map(({ row, direction, entry, timing, assessment, plan, configuredDecision }) => (
          <button
            key={`${row.symbol}-${direction}`}
            type="button"
            onClick={() => onSelect(row)}
            className="rounded-md border border-zinc-800 bg-zinc-950 p-3 text-left hover:border-zinc-600"
          >
            <span className="flex items-center justify-between">
              <span className="font-mono text-sm text-zinc-100">{row.display}</span>
              <span className={direction === "LONG" ? "text-emerald-300" : "text-rose-300"}>
                {direction}
              </span>
            </span>
            <span className="mt-2 block text-xs text-zinc-400">
              Entry <b className="font-mono text-zinc-200">{entry}</b> · Timing{" "}
              <b className="font-mono text-zinc-200">{timing}</b>
            </span>
            <span className="mt-1 block text-[11px] text-zinc-500">
              R/R {assessment.rewardRisk.toFixed(2)} · Move {assessment.potentialRewardPct.toFixed(2)}%
              {" "}· {assessment.entryType} · {configuredDecision}
            </span>
            <span className="mt-1 block text-[10px] text-zinc-500">
              SL {plan.levels.stopLossPct.toFixed(2)}% · TP1 {plan.levels.target1Pct.toFixed(2)}%
              {" "}· Lev {plan.leverage.min}〜{plan.leverage.max}x · {plan.holdingWindow}
            </span>
            <span className="mt-1 block text-[10px] text-zinc-500">
              {plan.riskTier} · Confidence {plan.confidenceScore} · Compounding {plan.compoundingQuality}
            </span>
            {assessment.lateEntryWarning ? (
              <span className="mt-1 block text-[10px] text-amber-300">
                STRONG TREND / LATE ENTRY
              </span>
            ) : null}
          </button>
        )) : (
          <p className="text-xs text-zinc-500">NO HIGH EXPECTANCY ENTRY — 現在、条件を満たす候補はありません。</p>
        )}
      </div>
    </section>
  );
}
