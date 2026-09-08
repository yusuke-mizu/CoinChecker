"use client";

import { useMemo } from "react";
import { buildExpectedValueSets } from "@/lib/scoring/signal-sets";
import type { SignalSettings, SignalStatus, TrackedSignal } from "@/lib/types/signals";

const PRIORITY = {
  STOP_LOSS: 7,
  STRONG_EXIT: 6,
  STRONG_TAKE_PROFIT: 5,
  TAKE_PROFIT: 4,
  REVERSAL: 3,
  WEAKENING: 2,
  ACTIVE: 1,
} as const;

function statusCopy(status: SignalStatus): string {
  switch (status) {
    case "STOP_LOSS_WATCH": return "STOP LOSS WATCH / 損切り検討";
    case "EXIT_WATCH": return "EXIT WATCH / 撤退検討";
    case "TAKE_PROFIT_WATCH": return "TAKE PROFIT WATCH / 利確検討";
    case "WEAKENING": return "WEAKENING / シグナル弱化";
    case "ACTIVE": return "ACTIVE / 保有継続候補";
    case "INVALIDATED": return "INVALIDATED / シグナル無効";
    case "EXPIRED": return "EXPIRED / 追跡期限終了";
    default: return "NEW / 追跡開始";
  }
}

function tone(signal: TrackedSignal): string {
  if (signal.alertPriority === "STOP_LOSS" || signal.alertPriority === "STRONG_EXIT") {
    return "border-rose-500/50 bg-rose-500/5 text-rose-200";
  }
  if (signal.alertPriority === "STRONG_TAKE_PROFIT" || signal.alertPriority === "TAKE_PROFIT") {
    return "border-amber-400/50 bg-amber-400/5 text-amber-100";
  }
  if (signal.status === "ACTIVE" || signal.status === "NEW") {
    return "border-emerald-500/40 bg-emerald-500/5 text-emerald-100";
  }
  return "border-zinc-700 bg-zinc-950 text-zinc-300";
}

function age(from: string): string {
  const minutes = Math.max(0, Math.floor((Date.now() - Date.parse(from)) / 60_000));
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours}h ${minutes % 60}m`;
  return `${Math.floor(hours / 24)}d ${hours % 24}h`;
}

export function TrackedSignalsPanel({
  signals,
  settings,
  onSelect,
}: {
  signals: TrackedSignal[];
  settings: SignalSettings;
  onSelect?: (symbol: string) => void;
}) {
  const ordered = useMemo(
    () => [...signals].sort(
      (a, b) =>
        PRIORITY[b.alertPriority] - PRIORITY[a.alertPriority] ||
        Date.parse(b.createdAt) - Date.parse(a.createdAt),
    ),
    [signals],
  );
  const sets = useMemo(
    () => buildExpectedValueSets(signals, settings.portfolioProtectionCount, settings.setLeverage),
    [signals, settings.portfolioProtectionCount, settings.setLeverage],
  );

  return (
    <section className="space-y-3 rounded-lg border border-zinc-800 bg-zinc-900/70 p-4">
      <div>
        <p className="text-[11px] tracking-[0.16em] text-zinc-500">EXISTING SIGNALS / MY SIGNALS</p>
        <h2 className="mt-1 text-sm font-semibold text-zinc-100">過去の高評価シグナル</h2>
        <p className="mt-1 text-[11px] text-zinc-500">
          Signal Priceは約定価格ではありません。表示は意思決定支援で、自動決済は行いません。
        </p>
      </div>

      {sets.length ? (
        <div className="grid gap-2 lg:grid-cols-3">
          {sets.map((set) => (
            <div key={set.name} className="rounded-md border border-zinc-700 bg-zinc-950 p-3 text-xs">
              <div className="flex items-center justify-between gap-2">
                <b>{set.name}</b>
                <span>Score {set.setScore}</span>
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
                {" "}· STRESS {set.stressLevel} · QUALITY {set.dataQuality.toFixed(0)} · {set.leverage}x Risk
              </p>
              {set.profitProtection ? (
                <p className="mt-2 font-semibold text-amber-300">PORTFOLIO PROFIT PROTECTION / 利益保護を検討</p>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}

      <div className="grid gap-3 lg:grid-cols-2">
        {ordered.length ? ordered.map((signal) => (
          <button
            key={signal.id}
            type="button"
            onClick={() => onSelect?.(signal.symbol)}
            className={`rounded-md border p-3 text-left ${tone(signal)}`}
          >
            <span className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-mono text-sm font-semibold">
                {signal.display} {signal.direction}
              </span>
              <span className="text-[10px]">{statusCopy(signal.status)}</span>
            </span>
            <span className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 font-mono text-[11px] text-zinc-300 sm:grid-cols-4">
              <span>Signal {signal.baseline.entry}</span>
              <span>Current {signal.current.entry}</span>
              <span>Timing {signal.current.timing}</span>
              <span>Reversal {signal.current.reversal}</span>
              <span>Deterioration {signal.deteriorationScore}</span>
              <span>Take Profit {signal.takeProfitScore}</span>
              <span>R/R {signal.current.rewardRisk.toFixed(2)}</span>
              <span>Data Quality {signal.current.dataQuality}</span>
              <span>Age {age(signal.createdAt)}</span>
            </span>
            <span className="mt-2 block text-[11px] text-zinc-400">
              Signal Price {signal.baseline.price} · Current {signal.current.price} · Price Change{" "}
              <b className={signal.priceChangePct >= 0 ? "text-emerald-300" : "text-rose-300"}>
                {signal.priceChangePct >= 0 ? "+" : ""}{signal.priceChangePct.toFixed(2)}%
              </b>
            </span>
            <span className="mt-1 block text-[10px] text-zinc-500">
              Source {signal.current.marketVenue?.toUpperCase() ?? "N/A"} · Confidence{" "}
              {signal.current.confidence ?? "N/A"} · {signal.evaluationState}
            </span>
          </button>
        )) : (
          <p className="text-xs text-zinc-500">追跡中のSignalはありません。通常分析完了時に条件判定します。</p>
        )}
      </div>
    </section>
  );
}
