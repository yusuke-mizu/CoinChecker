"use client";

import { useMemo } from "react";
import { assessMarketDecision } from "@/lib/scoring/market-decision";
import { buildExpectedValueSets } from "@/lib/scoring/signal-sets";
import type { MarketEnvSnapshot, SymbolAnalysis } from "@/lib/types/scoring";
import type { SignalSettings, TrackedSignal } from "@/lib/types/signals";
import type { TradePlan } from "@/lib/types/trade-decision";
import { formatPrice } from "@/components/format";

function tone(level: string): string {
  if (level === "ATTACK" || level === "LOW RISK") return "text-emerald-300";
  if (level === "DEFEND" || level === "HIGH RISK") return "text-rose-300";
  return "text-amber-300";
}

export function DecisionEnginePanel({
  rows,
  market,
  signals,
  settings,
}: {
  rows: SymbolAnalysis[];
  market: MarketEnvSnapshot | null;
  signals: TrackedSignal[];
  settings: SignalSettings;
}) {
  const decision = useMemo(() => assessMarketDecision(rows, market), [rows, market]);
  const opportunities = useMemo(
    () =>
      rows
        .flatMap((row) =>
          (["long", "short"] as const).flatMap((side) => {
            const assessment = row.entryExpectancy[side];
            const plan = row.tradePlans[side];
            return assessment && plan ? [{ row, assessment, plan }] : [];
          }),
        )
        .filter(
          ({ assessment, row }) =>
            assessment.total >= settings.watchEntryThreshold &&
            assessment.rewardRisk >= 1.5 &&
            assessment.reversalRisk < 70 &&
            row.dataQuality.score >= 50,
        )
        .sort(
          (a, b) =>
            b.assessment.total - a.assessment.total ||
            b.plan.compoundingQuality - a.plan.compoundingQuality,
        )
        .slice(0, 3),
    [rows, settings.watchEntryThreshold],
  );
  const primary = opportunities[0] ?? null;
  const sets = useMemo(
    () => buildExpectedValueSets(signals, settings.portfolioProtectionCount, settings.setLeverage),
    [signals, settings.portfolioProtectionCount, settings.setLeverage],
  );
  const recommended = sets.find((set) => set.name === decision.recommendedSet) ?? null;
  const defensive = opportunities.find(({ plan }) => plan.riskTier === "LOW RISK");
  const highReward = opportunities.find(({ plan }) => plan.highRiskHighReward);

  return (
    <section className="space-y-3">
      {decision.shock ? (
        <div className="rounded-lg border border-rose-500/60 bg-rose-950/40 p-3 text-sm font-semibold text-rose-200">
          MARKET SHOCK {decision.shockScore}/100 — 新規Entryを抑え、既存Exposureの確認を優先
        </div>
      ) : null}
      <div className="grid gap-3 lg:grid-cols-3">
        <article className="rounded-lg border border-zinc-800 bg-zinc-900/70 p-4">
          <p className="text-[11px] tracking-[0.16em] text-zinc-500">MARKET STATUS</p>
          <div className="mt-2 flex items-baseline justify-between">
            <b className={`text-xl ${tone(decision.attackLevel)}`}>{decision.attackLevel}</b>
            <span className="font-mono text-xs text-zinc-400">{decision.score}/100</span>
          </div>
          <p className="mt-2 text-xs leading-5 text-zinc-400">{decision.advice}</p>
          {decision.capitalPreservation ? (
            <p className="mt-2 font-semibold text-amber-300">CAPITAL PRESERVATION</p>
          ) : null}
          <div className="mt-2 text-[11px] text-zinc-500">
            {decision.reasons.slice(0, 4).join(" · ")}
          </div>
        </article>

        <article className="rounded-lg border border-zinc-800 bg-zinc-900/70 p-4 lg:col-span-2">
          <p className="text-[11px] tracking-[0.16em] text-zinc-500">BEST OPPORTUNITIES</p>
          {opportunities.length ? (
            <div className="mt-2 grid gap-2 sm:grid-cols-3">
              {opportunities.map(({ row, assessment, plan }, index) => (
                <div key={`${row.symbol}-${assessment.direction}`} className="rounded border border-zinc-700 p-2 text-xs">
                  <b>{index + 1}. {row.symbol} {assessment.direction}</b>
                  <p className="mt-1 text-zinc-400">
                    Entry {assessment.total} · R/R {plan.rewardRisk.toFixed(2)}
                  </p>
                  <p className={tone(plan.riskTier)}>
                    {plan.riskTier} · Compounding {plan.compoundingQuality}
                  </p>
                  <p className="text-zinc-500">{plan.entryLocation}</p>
                </div>
              ))}
            </div>
          ) : (
            <p className="mt-3 text-sm font-semibold text-zinc-300">NO HIGH EXPECTANCY ENTRY</p>
          )}
        </article>
      </div>

      {primary ? <TradePlanCard symbol={primary.row.symbol} plan={primary.plan} /> : null}

      <div className="grid gap-3 lg:grid-cols-2">
        <article className="rounded-lg border border-zinc-800 bg-zinc-900/70 p-4 text-xs">
          <p className="text-[11px] tracking-[0.16em] text-zinc-500">ADVICE</p>
          <p className="mt-2">Best risk/reward: <b>{primary ? `${primary.row.symbol} ${primary.plan.direction}` : "N/A"}</b></p>
          <p>Best defensive: <b>{defensive ? `${defensive.row.symbol} ${defensive.plan.direction}` : "N/A"}</b></p>
          <p>High risk / high reward: <b>{highReward ? `${highReward.row.symbol} ${highReward.plan.direction}` : "N/A"}</b></p>
          <p className="mt-2 text-zinc-400">
            Current recommendation: {decision.recommendedSet}
            {decision.optionalSet ? ` · Optional: ${decision.optionalSet}` : ""}
          </p>
          <p className="text-zinc-500">Avoid: {decision.avoid}</p>
        </article>
        <article className="rounded-lg border border-zinc-800 bg-zinc-900/70 p-4 text-xs">
          <p className="text-[11px] tracking-[0.16em] text-zinc-500">PORTFOLIO</p>
          {recommended ? (
            <>
              <div className="mt-2 grid grid-cols-2 gap-1 text-zinc-300">
                <span>Correlation Risk</span><b>{recommended.correlationRisk}</b>
                <span>Effective Diversification</span><b>{recommended.effectiveDiversification.toFixed(1)} / {recommended.members.length}</b>
                <span>Risk Budget Usage</span><b>{recommended.riskBudgetScore}/100</b>
                <span>Compounding Quality</span><b>{recommended.compoundingQuality}/100</b>
                <span>Portfolio Risk</span><b>{recommended.stressLevel}</b>
              </div>
              {recommended.alerts.map((alert) => (
                <p key={alert} className="mt-2 font-semibold text-amber-300">{alert}</p>
              ))}
            </>
          ) : (
            <p className="mt-2 text-zinc-500">有効な追跡Signalが不足しています。</p>
          )}
        </article>
      </div>
    </section>
  );
}

function TradePlanCard({ symbol, plan }: { symbol: string; plan: TradePlan }) {
  return (
    <article className="rounded-lg border border-cyan-800/70 bg-cyan-950/10 p-4 text-xs">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-[11px] tracking-[0.16em] text-cyan-400">TRADE PLAN</p>
          <h2 className="mt-1 text-base font-semibold">{symbol} {plan.direction}</h2>
        </div>
        <div className="text-right">
          <b className={tone(plan.riskTier)}>{plan.riskTier}</b>
          <p className="text-zinc-500">{plan.confidence} CONFIDENCE</p>
        </div>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Metric label="Entry Zone" value={`${formatPrice(plan.entryZoneLow)} - ${formatPrice(plan.entryZoneHigh)}`} />
        <Metric label="Breakout" value={plan.breakoutLevel == null ? "N/A" : formatPrice(plan.breakoutLevel)} />
        <Metric label="Structure Stop" value={`${formatPrice(plan.structureStop)} (${plan.structureStopPct.toFixed(2)}%)`} />
        <Metric label="Hard Stop" value={`${formatPrice(plan.hardStop)} (${plan.hardStopPct.toFixed(1)}%)`} />
        <Metric label="Invalidation" value={formatPrice(plan.invalidationLevel)} />
        <Metric label="TP1" value={formatPrice(plan.target1)} />
        <Metric label="TP2" value={formatPrice(plan.target2)} />
        <Metric label="R/R" value={plan.rewardRisk.toFixed(2)} />
      </div>
      <p className="mt-3 font-semibold text-cyan-200">{plan.entryLocation}</p>
      <p className="mt-1 text-zinc-400">
        {plan.breakoutStatus.replaceAll("_", " ")} · Overheat {plan.overheatScore} · Oversold {plan.oversoldScore} · {plan.pressureState}
      </p>
      {plan.structureBeyondHardStop ? (
        <p className="mt-2 font-semibold text-rose-300">Structure StopがHard Stop上限外です。現在のRisk条件ではNO ENTRYを優先。</p>
      ) : null}
      <div className="mt-3 grid gap-2 sm:grid-cols-2 text-zinc-400">
        <p><b className="text-zinc-200">WHY NOW?</b><br />{plan.thesis.whyNow}</p>
        <p><b className="text-zinc-200">WHAT MUST HAPPEN?</b><br />{plan.thesis.mustHappen}</p>
        <p><b className="text-zinc-200">INVALIDATION</b><br />{plan.thesis.invalidation}</p>
        <p><b className="text-zinc-200">MAIN RISK</b><br />{plan.thesis.mainRisk}</p>
      </div>
    </article>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded border border-zinc-800 bg-zinc-950/70 p-2">
      <p className="text-zinc-500">{label}</p>
      <p className="mt-1 font-mono text-zinc-200">{value}</p>
    </div>
  );
}
