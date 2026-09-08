"use client";

import { useMemo } from "react";
import { assessMarketDecision } from "@/lib/scoring/market-decision";
import { buildExpectedValueSets } from "@/lib/scoring/signal-sets";
import type { MarketEnvSnapshot, SymbolAnalysis } from "@/lib/types/scoring";
import type { SignalSettings, TrackedSignal } from "@/lib/types/signals";
import type { TradePlan } from "@/lib/types/trade-decision";
import type { ExpectedEntryAssessment } from "@/lib/scoring/expected-entry";
import { formatPrice } from "@/components/format";

type Opportunity = {
  row: SymbolAnalysis;
  assessment: ExpectedEntryAssessment;
  plan: TradePlan;
};

function tone(level: string): string {
  if (level === "ATTACK" || level === "LOW RISK" || level === "ENTRY NOW") return "text-emerald-300";
  if (level === "DEFEND" || level === "HIGH RISK" || level === "EXTREME RISK") return "text-rose-300";
  return "text-amber-300";
}

function label(item: Opportunity): string {
  return `${item.row.symbol} ${item.plan.direction}`;
}

export function DecisionEnginePanel({
  rows,
  market,
  signals,
  settings,
  onSelect,
}: {
  rows: SymbolAnalysis[];
  market: MarketEnvSnapshot | null;
  signals: TrackedSignal[];
  settings: SignalSettings;
  onSelect?: (row: SymbolAnalysis) => void;
}) {
  const decision = useMemo(() => assessMarketDecision(rows, market), [rows, market]);

  const opportunities = useMemo<Opportunity[]>(
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
          ({ assessment, plan, row }) =>
            assessment.total >= settings.watchEntryThreshold &&
            plan.levels.rewardRisk >= 1 &&
            assessment.reversalRisk < 70 &&
            row.dataQuality.score >= 50 &&
            !plan.structureBeyondHardStop,
        )
        .sort(
          (a, b) =>
            b.assessment.total - a.assessment.total ||
            b.plan.compoundingQuality - a.plan.compoundingQuality,
        ),
    [rows, settings.watchEntryThreshold],
  );

  const best = useMemo(() => {
    const pick = (
      items: Opportunity[],
      compare: (a: Opportunity, b: Opportunity) => number,
    ): Opportunity | null => (items.length ? [...items].sort(compare)[0] : null);
    return {
      entry: pick(opportunities, (a, b) => b.assessment.total - a.assessment.total),
      rewardRisk: pick(opportunities, (a, b) => b.plan.levels.rewardRisk - a.plan.levels.rewardRisk),
      long: pick(
        opportunities.filter((item) => item.plan.direction === "LONG"),
        (a, b) => b.assessment.total - a.assessment.total,
      ),
      short: pick(
        opportunities.filter((item) => item.plan.direction === "SHORT"),
        (a, b) => b.assessment.total - a.assessment.total,
      ),
      defensive: pick(
        opportunities.filter((item) => item.plan.riskTier === "LOW RISK"),
        (a, b) => b.plan.compoundingQuality - a.plan.compoundingQuality,
      ),
      highRisk: pick(
        opportunities.filter((item) => item.plan.highRiskHighReward),
        (a, b) => b.plan.potentialRewardPct - a.plan.potentialRewardPct,
      ),
    };
  }, [opportunities]);

  const riskCandidates = useMemo(
    () =>
      [...opportunities]
        .sort(
          (a, b) =>
            b.plan.estimatedExpectedValuePct - a.plan.estimatedExpectedValuePct ||
            b.plan.compoundingQuality - a.plan.compoundingQuality,
        )
        .slice(0, 3),
    [opportunities],
  );

  const sets = useMemo(
    () => buildExpectedValueSets(signals, settings.portfolioProtectionCount, settings.setLeverage),
    [signals, settings.portfolioProtectionCount, settings.setLeverage],
  );
  const recommended = sets.find((set) => set.name === decision.recommendedSet) ?? null;
  const headline = opportunities.slice(0, 3);
  const primary = best.entry;

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
          {headline.length ? (
            <div className="mt-2 grid gap-2 sm:grid-cols-3">
              {headline.map((item, index) => (
                <button
                  key={`${item.row.symbol}-${item.plan.direction}`}
                  type="button"
                  onClick={() => onSelect?.(item.row)}
                  className="rounded border border-zinc-700 p-2 text-left text-xs hover:border-zinc-500"
                >
                  <b>{index + 1}. {label(item)}</b>
                  <p className="mt-1 text-zinc-400">
                    Entry {item.assessment.total} · R/R 1:{item.plan.levels.rewardRisk.toFixed(2)}
                  </p>
                  <p className={tone(item.plan.riskTier)}>
                    {item.plan.riskTier} · Conf {item.plan.confidenceScore}
                  </p>
                  <p className="text-zinc-500">
                    {item.plan.entryVerdict} · {item.plan.leverage.min}〜{item.plan.leverage.max}x ·{" "}
                    {item.plan.holdingWindow}
                  </p>
                </button>
              ))}
            </div>
          ) : (
            <p className="mt-3 text-sm font-semibold text-zinc-300">NO HIGH QUALITY SETUP</p>
          )}
        </article>
      </div>

      {primary ? <TradePlanCard symbol={primary.row.symbol} plan={primary.plan} /> : null}

      <div className="grid gap-3 lg:grid-cols-3">
        <article className="rounded-lg border border-zinc-800 bg-zinc-900/70 p-4 text-xs">
          <p className="text-[11px] tracking-[0.16em] text-zinc-500">RISK OPPORTUNITY</p>
          <dl className="mt-2 space-y-1">
            <Pick term="BEST ENTRY" item={best.entry} detail={(item) => `Entry ${item.assessment.total}`} />
            <Pick term="BEST R/R" item={best.rewardRisk} detail={(item) => `1:${item.plan.levels.rewardRisk.toFixed(2)}`} />
            <Pick term="BEST LONG" item={best.long} detail={(item) => `Entry ${item.assessment.total}`} />
            <Pick term="BEST SHORT" item={best.short} detail={(item) => `Entry ${item.assessment.total}`} />
            <Pick term="BEST DEFENSIVE" item={best.defensive} detail={(item) => `Compounding ${item.plan.compoundingQuality}`} />
            <Pick
              term="HIGH RISK / HIGH REWARD"
              item={best.highRisk}
              detail={(item) => `+${item.plan.potentialRewardPct.toFixed(1)}% / ${item.plan.riskTier}`}
            />
          </dl>
          {riskCandidates.length ? (
            <p className="mt-2 text-zinc-400">
              リスクを取るなら:{" "}
              {riskCandidates
                .map((item) => `${label(item)} (推定EV ${item.plan.estimatedExpectedValuePct.toFixed(2)}%)`)
                .join(" / ")}
            </p>
          ) : null}
        </article>

        <article className="rounded-lg border border-zinc-800 bg-zinc-900/70 p-4 text-xs">
          <p className="text-[11px] tracking-[0.16em] text-zinc-500">ADVICE</p>
          <p className="mt-2 leading-5 text-zinc-300">{decision.advice}</p>
          {best.entry ? (
            <p className="mt-2 leading-5 text-zinc-400">
              {label(best.entry)}は{best.entry.plan.entryVerdict}の判定です。
              {best.entry.plan.entryVerdict === "WAIT FOR PULLBACK"
                ? `現在価格を追うより ${formatPrice(best.entry.plan.entryZoneLow)}〜${formatPrice(best.entry.plan.entryZoneHigh)} への戻りを待つ方がR/Rが改善します。`
                : `推奨Entry ${formatPrice(best.entry.plan.levels.entryReference)}、Stop ${formatPrice(best.entry.plan.levels.stopLoss)} でシナリオを管理できます。`}
            </p>
          ) : null}
          {best.highRisk ? (
            <p className="mt-2 leading-5 text-zinc-400">
              リスクを取るなら{label(best.highRisk)}に検討余地がありますが、Volatilityが高いためLeverageは
              {best.highRisk.plan.leverage.max}x以下に抑える構成が無難です。
            </p>
          ) : null}
          <p className="mt-2 text-zinc-500">
            Recommendation: {decision.recommendedSet}
            {decision.optionalSet ? ` · Optional: ${decision.optionalSet}` : ""} · Avoid: {decision.avoid}
          </p>
        </article>

        <article className="rounded-lg border border-zinc-800 bg-zinc-900/70 p-4 text-xs">
          <p className="text-[11px] tracking-[0.16em] text-zinc-500">PORTFOLIO</p>
          {recommended ? (
            <>
              <div className="mt-2 grid grid-cols-2 gap-1 text-zinc-300">
                <span>Correlation Risk</span><b>{recommended.correlationRisk}</b>
                <span>Effective Diversification</span>
                <b>{recommended.effectiveDiversification.toFixed(1)} / {recommended.members.length}</b>
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

function Pick({
  term,
  item,
  detail,
}: {
  term: string;
  item: Opportunity | null;
  detail: (item: Opportunity) => string;
}) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <dt className="text-zinc-500">{term}</dt>
      <dd className="text-right text-zinc-200">
        {item ? `${label(item)} · ${detail(item)}` : "N/A"}
      </dd>
    </div>
  );
}

function TradePlanCard({ symbol, plan }: { symbol: string; plan: TradePlan }) {
  const sign = plan.direction === "LONG" ? "+" : "-";
  return (
    <article className="rounded-lg border border-cyan-800/70 bg-cyan-950/10 p-4 text-xs">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-[11px] tracking-[0.16em] text-cyan-400">TRADE PLAN</p>
          <h2 className="mt-1 text-base font-semibold">{symbol} {plan.direction}</h2>
        </div>
        <div className="text-right">
          <b className={tone(plan.riskTier)}>{plan.riskTier}</b>
          <p className="text-zinc-500">CONFIDENCE {plan.confidenceScore} ({plan.confidence})</p>
        </div>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Metric label="Entry Zone" value={`${formatPrice(plan.entryZoneLow)} - ${formatPrice(plan.entryZoneHigh)}`} />
        <Metric label="推奨Entry" value={formatPrice(plan.levels.entryReference)} />
        <Metric
          label="推奨Stop Loss"
          value={`${formatPrice(plan.levels.stopLoss)} (-${plan.levels.stopLossPct.toFixed(2)}%)`}
        />
        <Metric label="Hard Stop" value={`${formatPrice(plan.hardStop)} (-${plan.hardStopPct}%)`} />
        <Metric
          label="Take Profit 1"
          value={`${formatPrice(plan.levels.target1)} (${sign}${plan.levels.target1Pct.toFixed(2)}%)`}
        />
        <Metric
          label="Take Profit 2"
          value={`${formatPrice(plan.levels.target2)} (${sign}${plan.levels.target2Pct.toFixed(2)}%)`}
        />
        <Metric label="R / R" value={`1 : ${plan.levels.rewardRisk.toFixed(2)}`} />
        <Metric label="Breakout" value={plan.breakoutLevel == null ? "N/A" : formatPrice(plan.breakoutLevel)} />
        <Metric label="Invalidation" value={formatPrice(plan.invalidationLevel)} />
        <Metric label="推奨Leverage" value={`${plan.leverage.min}〜${plan.leverage.max}x`} />
        <Metric label="推奨保有時間" value={plan.holdingWindow} />
        <Metric
          label="Margin ROI / Loss"
          value={`+${plan.leverage.marginRoiAtTarget1Pct.toFixed(1)}% / -${plan.leverage.marginLossAtStopPct.toFixed(1)}%`}
        />
      </div>

      <p className={`mt-3 font-semibold ${tone(plan.entryVerdict)}`}>{plan.entryVerdict}</p>
      <p className="mt-1 text-zinc-400">
        {plan.breakoutStatus.replaceAll("_", " ")} · Overheat {plan.overheatScore} · Oversold{" "}
        {plan.oversoldScore} · {plan.pressureState}
      </p>
      <p className="mt-1 text-zinc-400">
        Expected Move 15M {plan.expectedMove15mPct?.toFixed(2) ?? "—"}% · 1H{" "}
        {plan.expectedMove1hPct?.toFixed(2) ?? "—"}% · 4H {plan.expectedMove4hPct?.toFixed(2) ?? "—"}%
        {" "}· 推定EV {plan.estimatedExpectedValuePct >= 0 ? "+" : ""}
        {plan.estimatedExpectedValuePct.toFixed(2)}%
      </p>
      {plan.leverage.warning ? (
        <p className="mt-2 font-semibold text-rose-300">{plan.leverage.warning}</p>
      ) : null}
      {plan.structureBeyondHardStop ? (
        <p className="mt-2 font-semibold text-rose-300">
          Structure StopがHard Stop上限外です。現在のRisk条件ではNO ENTRYを優先。
        </p>
      ) : null}

      <div className="mt-3 grid gap-2 text-zinc-400 sm:grid-cols-2">
        <p><b className="text-zinc-200">WHY NOW?</b><br />{plan.thesis.whyNow}</p>
        <p><b className="text-zinc-200">WHAT MUST HAPPEN?</b><br />{plan.thesis.mustHappen}</p>
        <p><b className="text-zinc-200">INVALIDATION</b><br />{plan.thesis.invalidation}</p>
        <p><b className="text-zinc-200">MAIN RISK</b><br />{plan.thesis.mainRisk}</p>
      </div>
      <p className="mt-3 text-[11px] text-zinc-500">
        SL / TPは予測ではなく、現在の市場データから算出した推奨ラインです。推定EVは実測勝率ではありません。
      </p>
    </article>
  );
}

function Metric({ label: name, value }: { label: string; value: string }) {
  return (
    <div className="rounded border border-zinc-800 bg-zinc-950/70 p-2">
      <p className="text-zinc-500">{name}</p>
      <p className="mt-1 font-mono text-zinc-200">{value}</p>
    </div>
  );
}
