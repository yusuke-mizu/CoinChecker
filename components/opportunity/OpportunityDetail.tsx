"use client";

import { formatPct, formatPrice } from "@/components/format";
import { VERDICT_ICON, starLabel, stars, verdictClass } from "./verdict";
import type { OpportunityRow, OpportunitySide } from "@/lib/types/opportunity";

function compactUsd(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return "—";
  if (value >= 1e9) return `$${(value / 1e9).toFixed(2)}B`;
  if (value >= 1e6) return `$${(value / 1e6).toFixed(1)}M`;
  if (value >= 1e3) return `$${(value / 1e3).toFixed(0)}K`;
  return `$${value.toFixed(0)}`;
}

/** Time-by-time reach table: the answer to "how long should I hold this?". */
function HorizonTable({ side }: { side: OpportunitySide }) {
  const sign = side.direction === "LONG" ? "+" : "-";
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-[11px]">
        <thead className="text-[10px] tracking-[0.1em] text-zinc-500">
          <tr>
            <th className="py-1 pr-3 font-normal">保有時間</th>
            <th className="py-1 pr-3 font-normal">目標</th>
            <th className="py-1 pr-3 font-normal">利益到達確率</th>
            <th className="py-1 pr-3 font-normal">損切確率</th>
            <th className="py-1 pr-3 font-normal">推奨TP/SLの期待値</th>
            <th className="py-1 font-normal">時間当たり</th>
          </tr>
        </thead>
        <tbody className="font-mono">
          {side.horizons.map((horizon) => (
            <tr
              key={horizon.label}
              className={horizon.recommended ? "bg-emerald-400/5 text-zinc-100" : "text-zinc-300"}
            >
              <td className="py-1 pr-3">
                {horizon.label}
                {horizon.recommended && <span className="ml-1 text-emerald-400">◀ 推奨</span>}
              </td>
              <td className="py-1 pr-3 text-zinc-400">
                {sign}
                {horizon.levelPct.toFixed(1)}%
              </td>
              <td className="py-1 pr-3 text-emerald-300">{horizon.probability.toFixed(0)}%</td>
              <td className="py-1 pr-3 text-rose-300">{horizon.stopProbability.toFixed(0)}%</td>
              <td
                className={`py-1 pr-3 ${
                  horizon.expectedValuePct >= 0 ? "text-emerald-300" : "text-rose-300"
                }`}
              >
                {formatPct(horizon.expectedValuePct)}
              </td>
              <td className="py-1 text-zinc-400">
                {formatPct(horizon.expectedValuePerHourPct)}/h
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-1 text-[10px] text-zinc-500">
        目標列は各時間軸の代表的な値幅（15/30分は{sign}0.5%、1/2時間は{sign}1.0%、4時間は{sign}
        2.0%）への到達確率です。期待値の列は推奨TP {sign}
        {side.recommendedTargetPct.toFixed(1)}% / SL{" "}
        {side.direction === "LONG" ? "-" : "+"}
        {side.stop.pct.toFixed(2)}% をその時間で決済した場合の推定値です。
      </p>
    </div>
  );
}

/** TP grid at the recommended stop, so the chosen level can be checked against the rest. */
function TargetTable({ side }: { side: OpportunitySide }) {
  const sign = side.direction === "LONG" ? "+" : "-";
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-[11px]">
        <thead className="text-[10px] tracking-[0.1em] text-zinc-500">
          <tr>
            <th className="py-1 pr-3 font-normal">TP</th>
            <th className="py-1 pr-3 font-normal">価格</th>
            <th className="py-1 pr-3 font-normal">TP先着</th>
            <th className="py-1 pr-3 font-normal">SL先着</th>
            <th className="py-1 pr-3 font-normal">未決着</th>
            <th className="py-1 pr-3 font-normal">コスト</th>
            <th className="py-1 pr-3 font-normal">期待値</th>
            <th className="py-1 font-normal">R/R</th>
          </tr>
        </thead>
        <tbody className="font-mono">
          {side.targets.map((target) => (
            <tr
              key={target.pct}
              className={target.recommended ? "bg-emerald-400/5 text-zinc-100" : "text-zinc-300"}
            >
              <td className="py-1 pr-3">
                {sign}
                {target.pct.toFixed(1)}%
                {target.recommended && <span className="ml-1 text-emerald-400">◀</span>}
              </td>
              <td className="py-1 pr-3 text-zinc-400">{formatPrice(target.price)}</td>
              <td className="py-1 pr-3 text-emerald-300">
                {target.targetProbability.toFixed(0)}%
              </td>
              <td className="py-1 pr-3 text-rose-300">{target.stopProbability.toFixed(0)}%</td>
              <td className="py-1 pr-3 text-zinc-400">
                {target.neitherProbability.toFixed(0)}%
              </td>
              <td className="py-1 pr-3 text-zinc-500">-{target.costPct.toFixed(2)}%</td>
              <td
                className={`py-1 pr-3 ${
                  target.expectedValuePct >= 0 ? "text-emerald-300" : "text-rose-300"
                }`}
              >
                {formatPct(target.expectedValuePct)}
              </td>
              <td className="py-1 text-zinc-400">1:{target.rewardRisk.toFixed(2)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-1 text-[10px] text-zinc-500">
        コスト列は往復のTaker手数料・想定Slippage・保有時間分のFundingを含みます。「未決着」はその時間内に
        TPもSLも触れなかったケースで、推定ドリフトで評価しています。
      </p>
    </div>
  );
}

function SidePanel({ side }: { side: OpportunitySide }) {
  const isLong = side.direction === "LONG";
  return (
    <section className="space-y-3 rounded-lg border border-zinc-800 bg-zinc-900/40 p-3">
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <span
          className={`rounded border px-1.5 py-0.5 text-[10px] tracking-[0.1em] ${verdictClass(
            side.verdict,
          )}`}
        >
          {VERDICT_ICON[side.verdict]} {side.direction} · {side.verdict}
        </span>
        <span className="text-[12px] text-amber-300">
          {stars(side.stars)}{" "}
          <span className="text-[10px] text-zinc-400">{starLabel(side.verdict, side.stars)}</span>
        </span>
      </header>

      <div className="grid grid-cols-2 gap-x-3 gap-y-2 sm:grid-cols-4">
        {[
          ["Expected Value", formatPct(side.expectedValuePct)],
          ["時間当たり", `${formatPct(side.expectedValuePerHourPct)}/h`],
          ["推奨レバレッジ時ROI", formatPct(side.marginRoiPct)],
          ["Risk / Reward", `1 : ${side.rewardRisk.toFixed(2)}`],
          [
            "推奨SL",
            `${isLong ? "-" : "+"}${side.stop.pct.toFixed(2)}% (${formatPrice(side.stop.price)})`,
          ],
          [
            "推奨TP",
            `${side.targetRangeLabel.replace("+", isLong ? "+" : "-")} (${formatPrice(
              side.recommendedTargetPrice,
            )})`,
          ],
          ["推奨保有時間", side.holding.label],
          ["往復コスト", `-${side.costPct.toFixed(2)}%`],
        ].map(([label, value]) => (
          <div key={label}>
            <p className="text-[10px] tracking-[0.1em] text-zinc-500">{label}</p>
            <p className="font-mono text-[12px] text-zinc-100">{value}</p>
          </div>
        ))}
      </div>

      <div>
        <p className="text-[10px] tracking-[0.12em] text-zinc-500">推奨レバレッジ</p>
        <p className="mt-0.5 font-mono text-[12px] text-zinc-100">
          {side.leverage.recommendedMin}〜{side.leverage.recommendedMax}x
          <span className="ml-2 text-[11px] text-zinc-400">
            Conservative {side.leverage.conservativeMin}〜{side.leverage.conservativeMax}x ／
            Aggressive {side.leverage.aggressiveMin}〜{side.leverage.aggressiveMax}x
          </span>
        </p>
        <p className="mt-0.5 text-[10px] text-zinc-500">
          {side.leverage.caps.length > 0
            ? side.leverage.caps.join(" / ")
            : `SL距離とボラティリティから上限${side.leverage.maxSafe}x`}
        </p>
      </div>

      <HorizonTable side={side} />
      <TargetTable side={side} />

      <ul className="space-y-0.5 text-[10px] text-zinc-500">
        {side.reasons.map((reason) => (
          <li key={reason}>・{reason}</li>
        ))}
      </ul>
      {side.warnings.length > 0 && (
        <ul className="space-y-0.5 text-[10px] text-amber-300/90">
          {side.warnings.map((warning) => (
            <li key={warning}>⚠ {warning}</li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function OpportunityDetail({
  row,
  onClose,
}: {
  row: OpportunityRow;
  onClose: () => void;
}) {
  return (
    <div className="space-y-3 rounded-lg border border-zinc-700 bg-zinc-950/80 p-3">
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="flex flex-wrap items-baseline gap-2">
          <h3 className="font-mono text-base text-zinc-100">{row.display}</h3>
          <span className="font-mono text-xs text-zinc-400">{formatPrice(row.lastPrice)}</span>
          <span
            className={`font-mono text-xs ${
              (row.change24hPct ?? 0) >= 0 ? "text-emerald-400" : "text-rose-400"
            }`}
          >
            {formatPct(row.change24hPct)}
          </span>
          <span className="rounded border border-zinc-700 px-1 py-0.5 text-[10px] text-zinc-400">
            {row.venue.toUpperCase()}
          </span>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="rounded border border-zinc-700 px-2 py-0.5 text-[11px] text-zinc-300 hover:bg-zinc-800"
        >
          閉じる
        </button>
      </header>

      <p className="text-[10px] text-zinc-500">
        内部計算に使用: ATR {row.atrPct.toFixed(2)}% / RSI{" "}
        {row.rsi == null ? "—" : row.rsi.toFixed(0)} / Volume比{" "}
        {row.volumeRatio == null ? "—" : row.volumeRatio.toFixed(2)} / Trend {row.trend} / Funding{" "}
        {row.fundingRatePct == null ? "—" : `${row.fundingRatePct.toFixed(4)}%`} / OI{" "}
        {compactUsd(row.openInterestUsd)} / Order Flow{" "}
        {row.orderFlowDelta == null ? "未取得" : row.orderFlowDelta.toFixed(2)} / 24h Turnover{" "}
        {compactUsd(row.turnoverUsd)} / 類似局面 {row.effectiveSampleSize}件相当（全{" "}
        {row.sampleSize}件）
      </p>

      <div className="grid gap-3 lg:grid-cols-2">
        {row.long && <SidePanel side={row.long} />}
        {row.short && <SidePanel side={row.short} />}
      </div>

      {row.notes.length > 0 && (
        <p className="text-[10px] text-zinc-500">{row.notes.join(" / ")}</p>
      )}
    </div>
  );
}
