"use client";

import { formatPct, formatPrice } from "@/components/format";
import { VERDICT_ICON, VERDICT_LABEL, starLabel, stars, verdictClass } from "./verdict";
import type { OpportunityRow, OpportunitySide } from "@/lib/types/opportunity";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-[10px] tracking-[0.12em] text-zinc-500">{label}</p>
      <p className="font-mono text-[13px] text-zinc-100">{children}</p>
    </div>
  );
}

/** The whole decision for one symbol and one direction, in the order you read it. */
export function OpportunityCard({
  row,
  side,
  onOpen,
}: {
  row: OpportunityRow;
  side: OpportunitySide;
  onOpen: () => void;
}) {
  const isLong = side.direction === "LONG";
  const holdingHorizon = side.horizons.find((horizon) => horizon.recommended);
  const sign = isLong ? "+" : "-";

  return (
    <article className="rounded-lg border border-zinc-800 bg-zinc-900/60 p-3">
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="flex items-baseline gap-2">
          <button
            type="button"
            onClick={onOpen}
            className="font-mono text-sm text-zinc-100 underline decoration-zinc-700 underline-offset-4 hover:decoration-zinc-400"
          >
            {row.display}
          </button>
          <span className="font-mono text-[11px] text-zinc-500">
            {formatPrice(row.lastPrice)}
          </span>
          <span
            className={`font-mono text-[11px] ${
              (row.change24hPct ?? 0) >= 0 ? "text-emerald-400" : "text-rose-400"
            }`}
          >
            {formatPct(row.change24hPct)}
          </span>
        </div>
        <span
          className={`rounded border px-1.5 py-0.5 text-[10px] tracking-[0.1em] ${verdictClass(
            side.verdict,
          )}`}
        >
          {VERDICT_ICON[side.verdict]} {side.direction} · {VERDICT_LABEL[side.verdict]}
        </span>
      </header>

      <p className="mt-2 text-[11px] text-zinc-500">今の価格から入った場合の目安（確定ではありません）</p>

      <div className="mt-1 grid grid-cols-2 gap-x-3 gap-y-2">
        <Field label="利益到達確率">
          <span className="text-emerald-300">
            {holdingHorizon?.label ?? side.holding.label}で {sign}
            {side.recommendedTargetPct.toFixed(1)}% ・{" "}
            {side.profitProbability.toFixed(0)}%
          </span>
        </Field>
        <Field label="損切確率">
          <span className="text-rose-300">
            {isLong ? "-" : "+"}
            {side.stop.pct.toFixed(2)}% ・ {side.stopProbability.toFixed(0)}%
          </span>
        </Field>
        <Field label="EXPECTED VALUE">
          <span
            className={side.expectedValuePct >= 0 ? "text-emerald-300" : "text-rose-300"}
          >
            {formatPct(side.expectedValuePct)}
          </span>
        </Field>
        <Field label="RISK / REWARD">1 : {side.rewardRisk.toFixed(2)}</Field>
        <Field label="推奨SL">
          {isLong ? "-" : "+"}
          {side.stop.pct.toFixed(2)}%{" "}
          <span className="text-[10px] text-zinc-500">({formatPrice(side.stop.price)})</span>
        </Field>
        <Field label="推奨TP">
          {side.targetRangeLabel.replace("+", sign)}{" "}
          <span className="text-[10px] text-zinc-500">
            ({formatPrice(side.recommendedTargetPrice)})
          </span>
        </Field>
        <Field label="推奨レバレッジ">
          {side.leverage.recommendedMin === side.leverage.recommendedMax
            ? `${side.leverage.recommendedMax}x`
            : `${side.leverage.recommendedMin}〜${side.leverage.recommendedMax}x`}
        </Field>
        <Field label="推奨保有時間">{side.holding.label}</Field>
      </div>

      <p className="mt-2 text-[10px] text-zinc-500">SL根拠: {side.stop.reason}</p>

      <footer className="mt-2 flex flex-wrap items-center justify-between gap-2">
        <span className="text-[12px] text-amber-300">
          {stars(side.stars)}{" "}
          <span className="text-[10px] text-zinc-400">{starLabel(side.verdict, side.stars)}</span>
        </span>
        <span className="text-[10px] text-zinc-500">信頼度 {side.confidence}</span>
      </footer>

      {side.warnings.length > 0 && (
        <p className="mt-1 text-[10px] text-amber-300/90">⚠ {side.warnings.join(" / ")}</p>
      )}
    </article>
  );
}
