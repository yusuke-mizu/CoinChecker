"use client";

import { formatNum, formatPct, formatPrice } from "@/components/format";
import type { EntryGrade, ReachAnalysis } from "@/lib/types/reach";

const GRADE_TONE: Record<EntryGrade, string> = {
  EXCELLENT: "text-emerald-300",
  GOOD: "text-emerald-200",
  FAIR: "text-amber-200",
  POOR: "text-orange-300",
  AVOID: "text-rose-300",
};

function timingTone(timing: string): string {
  if (timing === "ENTRY NOW") return "text-emerald-300";
  if (timing.startsWith("NO ENTRY")) return "text-rose-300";
  return "text-amber-300";
}

function probabilityBar(probability: number, tone: string) {
  return (
    <span className="h-1.5 w-16 overflow-hidden rounded bg-zinc-800">
      <span className={`block h-full rounded ${tone}`} style={{ width: `${probability}%` }} />
    </span>
  );
}

export function ReachPanel({
  symbol,
  analysis,
}: {
  symbol: string;
  analysis: ReachAnalysis | null;
}) {
  if (!analysis) {
    return (
      <div className="rounded-lg border border-zinc-800 bg-zinc-900/60 p-3 text-xs text-zinc-500">
        到達確率を推定するのに十分な履歴がありません。
      </div>
    );
  }

  const sign = analysis.direction === "LONG" ? "+" : "-";
  const adverseSign = analysis.direction === "LONG" ? "-" : "+";

  return (
    <article className="rounded-lg border border-zinc-800 bg-zinc-900/60 p-4 text-xs">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold">
          {symbol}{" "}
          <span className={analysis.direction === "LONG" ? "text-emerald-300" : "text-rose-300"}>
            {analysis.direction}
          </span>
        </h3>
        <p className="text-[11px] text-zinc-500">
          今Entryした場合 / 想定期間 {analysis.horizonHours}時間 ·{" "}
          {analysis.barTimeframe}足 · 推定Confidence {analysis.confidence}
        </p>
      </div>

      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <div>
          <p className="text-[11px] tracking-[0.14em] text-zinc-500">利益幅への到達確率</p>
          <dl className="mt-1 space-y-1">
            {analysis.favorable.map((estimate) => (
              <div key={estimate.levelPct} className="flex items-center gap-2">
                <dt className="w-16 font-mono text-zinc-400">
                  {sign}
                  {estimate.levelPct}%
                </dt>
                {probabilityBar(estimate.probability, "bg-emerald-500/70")}
                <dd className="font-mono text-zinc-100">{estimate.probability.toFixed(0)}%</dd>
              </div>
            ))}
          </dl>
        </div>
        <div>
          <p className="text-[11px] tracking-[0.14em] text-zinc-500">損失幅への到達確率</p>
          <dl className="mt-1 space-y-1">
            {analysis.adverse.map((estimate) => (
              <div key={estimate.levelPct} className="flex items-center gap-2">
                <dt className="w-16 font-mono text-zinc-400">
                  {adverseSign}
                  {estimate.levelPct}%
                </dt>
                {probabilityBar(estimate.probability, "bg-rose-500/70")}
                <dd className="font-mono text-zinc-100">{estimate.probability.toFixed(0)}%</dd>
              </div>
            ))}
          </dl>
        </div>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Metric
          label="推奨SL"
          value={`${adverseSign}${analysis.recommendedStopPct.toFixed(1)}%`}
          sub={formatPrice(analysis.recommendedStopPrice)}
        />
        <Metric
          label="推奨TP1"
          value={`${sign}${analysis.recommendedTarget1Pct.toFixed(1)}%`}
          sub={formatPrice(analysis.recommendedTarget1Price)}
        />
        <Metric
          label="推奨TP2"
          value={`${sign}${analysis.recommendedTarget2Pct.toFixed(1)}%`}
          sub={formatPrice(analysis.recommendedTarget2Price)}
        />
        <Metric label="R / R" value={`1 : ${formatNum(analysis.rewardRisk)}`} />
        <Metric
          label="推定Expected Value"
          value={formatPct(analysis.expectedValuePct)}
          tone={analysis.expectedValuePct > 0 ? "text-emerald-300" : "text-rose-300"}
        />
        <Metric label="推奨保有時間" value={analysis.holdingWindow} />
        <Metric
          label="Entry Timing"
          value={analysis.entryTiming}
          tone={timingTone(analysis.entryTiming)}
        />
        <Metric
          label="Entry評価"
          value={analysis.entryGrade}
          tone={GRADE_TONE[analysis.entryGrade]}
        />
      </div>

      <table className="mt-3 w-full text-[11px]">
        <thead className="text-zinc-500">
          <tr>
            <th className="text-left font-normal">TP候補</th>
            <th className="text-right font-normal">SL</th>
            <th className="text-right font-normal">TP先着</th>
            <th className="text-right font-normal">SL先着</th>
            <th className="text-right font-normal">未到達</th>
            <th className="text-right font-normal">R/R</th>
            <th className="text-right font-normal">推定EV</th>
          </tr>
        </thead>
        <tbody className="font-mono">
          {analysis.candidates.map((candidate) => (
            <tr
              key={candidate.targetPct}
              className={`border-t border-zinc-900 ${
                candidate.recommended ? "bg-cyan-950/20 text-cyan-100" : "text-zinc-300"
              }`}
            >
              <td className="py-1 text-left">
                {sign}
                {candidate.targetPct}%{candidate.recommended ? " ★" : ""}
              </td>
              <td className="text-right text-zinc-400">
                {adverseSign}
                {candidate.stopPct}%
              </td>
              <td className="text-right">{candidate.targetProbability.toFixed(0)}%</td>
              <td className="text-right text-rose-300">{candidate.stopProbability.toFixed(0)}%</td>
              <td className="text-right text-zinc-500">
                {candidate.neitherProbability.toFixed(0)}%
              </td>
              <td className="text-right text-zinc-400">{formatNum(candidate.rewardRisk)}</td>
              <td
                className={`text-right ${
                  candidate.expectedValuePct > 0 ? "text-emerald-300" : "text-rose-300"
                }`}
              >
                {formatPct(candidate.expectedValuePct)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="mt-3 space-y-1 text-[11px] text-zinc-500">
        <p>
          方向一致確率 {analysis.favorableAnyProbability.toFixed(0)}% / 逆行{" "}
          {analysis.adverseAnyProbability.toFixed(0)}% · 期間ボラティリティ{" "}
          {analysis.volatilityPerHorizonPct.toFixed(2)}% · Chase Risk {analysis.chaseRisk}
        </p>
        {analysis.reasons.map((reason) => (
          <p key={reason}>{reason}</p>
        ))}
        <p className="text-zinc-600">
          確率は過去データと現在の市場状態から推定した値で、実際の将来確率ではありません。確率が高いこと
          だけを理由にEntryを推奨しません。Expected Value・R/R・Stop Risk・Entry Timing・Market Regimeを
          併せて判断してください。
        </p>
      </div>
    </article>
  );
}

function Metric({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: string;
}) {
  return (
    <div className="rounded border border-zinc-800 bg-zinc-950/70 p-2">
      <p className="text-[10px] tracking-[0.12em] text-zinc-500">{label}</p>
      <p className={`mt-1 font-mono text-sm ${tone ?? "text-zinc-100"}`}>{value}</p>
      {sub ? <p className="font-mono text-[10px] text-zinc-500">{sub}</p> : null}
    </div>
  );
}
