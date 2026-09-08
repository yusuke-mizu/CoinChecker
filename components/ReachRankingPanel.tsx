"use client";

import { useMemo, useState } from "react";
import { formatNum, formatPct } from "@/components/format";
import type { SymbolAnalysis } from "@/lib/types/scoring";
import type { ReachAnalysis } from "@/lib/types/reach";

type Row = {
  row: SymbolAnalysis;
  reach: ReachAnalysis;
};

function probabilityAt(reach: ReachAnalysis, levelPct: number): number {
  return reach.favorable.find((estimate) => estimate.levelPct === levelPct)?.probability ?? 0;
}

function RankingCard({
  title,
  hint,
  rows,
  value,
  onSelect,
}: {
  title: string;
  hint: string;
  rows: Row[];
  value: (item: Row) => string;
  onSelect: (row: SymbolAnalysis) => void;
}) {
  return (
    <article className="rounded-lg border border-zinc-800 bg-zinc-900/60 p-3">
      <p className="text-[11px] tracking-[0.14em] text-zinc-500">{title}</p>
      <p className="mt-0.5 text-[10px] text-zinc-600">{hint}</p>
      {rows.length === 0 ? (
        <p className="mt-2 text-xs text-zinc-500">該当なし</p>
      ) : (
        <ol className="mt-2 space-y-1">
          {rows.map((item, index) => (
            <li key={`${item.row.symbol}-${item.reach.direction}`}>
              <button
                type="button"
                onClick={() => onSelect(item.row)}
                className="flex w-full items-baseline justify-between gap-2 rounded px-1 py-0.5 text-[11px] hover:bg-zinc-800/60"
              >
                <span className="truncate">
                  <span className="text-zinc-500">{index + 1}.</span>{" "}
                  <span className="font-mono text-zinc-200">{item.row.display}</span>{" "}
                  <span
                    className={
                      item.reach.direction === "LONG" ? "text-emerald-400" : "text-rose-400"
                    }
                  >
                    {item.reach.direction}
                  </span>
                </span>
                <span className="shrink-0 font-mono text-zinc-100">{value(item)}</span>
              </button>
            </li>
          ))}
        </ol>
      )}
    </article>
  );
}

export function ReachRankingPanel({
  rows,
  onSelect,
}: {
  rows: SymbolAnalysis[];
  onSelect: (row: SymbolAnalysis) => void;
}) {
  const [minConfidence, setMinConfidence] = useState(40);

  const all = useMemo<Row[]>(
    () =>
      rows.flatMap((row) =>
        (["long", "short"] as const).flatMap((side) => {
          const reach = row.reach?.[side];
          return reach && reach.confidence >= minConfidence ? [{ row, reach }] : [];
        }),
      ),
    [rows, minConfidence],
  );

  const longs = useMemo(() => all.filter((item) => item.reach.direction === "LONG"), [all]);
  const shorts = useMemo(() => all.filter((item) => item.reach.direction === "SHORT"), [all]);

  const top = (source: Row[], score: (item: Row) => number, limit = 5): Row[] =>
    [...source]
      .filter((item) => Number.isFinite(score(item)))
      .sort((a, b) => score(b) - score(a))
      .slice(0, limit);

  const positiveEv = (item: Row) => item.reach.expectedValuePct > 0;

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold tracking-[0.14em] text-zinc-300">
            REALTIME REACH PROBABILITY
          </h2>
          <p className="mt-1 text-[11px] text-zinc-500">
            全監視銘柄について、現在価格でLONG / SHORTした場合の到達確率と推定期待値を
            方向ごとに独立評価しています（対象 {all.length} 件）。
          </p>
        </div>
        <label className="text-[11px] text-zinc-500">
          推定Confidence下限 {minConfidence}
          <input
            type="range"
            min={0}
            max={90}
            step={5}
            value={minConfidence}
            onChange={(event) => setMinConfidence(Number(event.target.value))}
            className="ml-2 w-32 align-middle"
          />
        </label>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <RankingCard
          title="LONG EXPECTED VALUE"
          hint="推奨TP/SL組み合わせでの推定EV"
          rows={top(longs, (item) => item.reach.expectedValuePct)}
          value={(item) => formatPct(item.reach.expectedValuePct)}
          onSelect={onSelect}
        />
        <RankingCard
          title="SHORT EXPECTED VALUE"
          hint="推奨TP/SL組み合わせでの推定EV"
          rows={top(shorts, (item) => item.reach.expectedValuePct)}
          value={(item) => formatPct(item.reach.expectedValuePct)}
          onSelect={onSelect}
        />
        <RankingCard
          title="BEST IMMEDIATE ENTRY"
          hint="ENTRY NOW判定かつEVプラスのみ"
          rows={top(
            all.filter((item) => item.reach.entryTiming === "ENTRY NOW" && positiveEv(item)),
            (item) => item.reach.expectedValuePct * item.reach.rewardRisk,
          )}
          value={(item) => `${formatPct(item.reach.expectedValuePct)} / ${item.reach.entryGrade}`}
          onSelect={onSelect}
        />
        <RankingCard
          title="LONG +3% PROBABILITY"
          hint="4時間以内に+3%へ到達する推定確率"
          rows={top(longs, (item) => probabilityAt(item.reach, 3))}
          value={(item) => `${probabilityAt(item.reach, 3).toFixed(0)}%`}
          onSelect={onSelect}
        />
        <RankingCard
          title="SHORT +3% PROBABILITY"
          hint="4時間以内に-3%へ到達する推定確率"
          rows={top(shorts, (item) => probabilityAt(item.reach, 3))}
          value={(item) => `${probabilityAt(item.reach, 3).toFixed(0)}%`}
          onSelect={onSelect}
        />
        <RankingCard
          title="BEST RISK / REWARD"
          hint="推奨TP1 ÷ 推奨SL。EVプラスのみ"
          rows={top(all.filter(positiveEv), (item) => item.reach.rewardRisk)}
          value={(item) => `1 : ${formatNum(item.reach.rewardRisk)}`}
          onSelect={onSelect}
        />
        <RankingCard
          title="LONG +5% PROBABILITY"
          hint="4時間以内に+5%へ到達する推定確率"
          rows={top(longs, (item) => probabilityAt(item.reach, 5))}
          value={(item) => `${probabilityAt(item.reach, 5).toFixed(0)}%`}
          onSelect={onSelect}
        />
        <RankingCard
          title="SHORT +5% PROBABILITY"
          hint="4時間以内に-5%へ到達する推定確率"
          rows={top(shorts, (item) => probabilityAt(item.reach, 5))}
          value={(item) => `${probabilityAt(item.reach, 5).toFixed(0)}%`}
          onSelect={onSelect}
        />
        <RankingCard
          title="LOWEST STOP RISK"
          hint="推奨SLまでの距離が小さく、EVがプラスの候補"
          rows={top(all.filter(positiveEv), (item) => -item.reach.recommendedStopPct)}
          value={(item) => `-${item.reach.recommendedStopPct.toFixed(1)}%`}
          onSelect={onSelect}
        />
      </div>

      <p className="text-[11px] leading-5 text-zinc-500">
        「+5%到達 53%」のような数値は、過去データと現在の市場状態から推定した確率であり、実際の未来の
        確率ではありません。総合Scoreだけ、あるいは確率だけで銘柄を選ばず、Probability・Expected
        Value・Risk/Reward・Stop Risk・Entry Timing・Market Regimeを併せて確認してください。条件を
        満たす候補が少ない場合、無理に選ばないことも正常な結果です。
      </p>
    </section>
  );
}
