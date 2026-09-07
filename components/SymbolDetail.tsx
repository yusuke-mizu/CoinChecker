"use client";

import { useMemo, useState } from "react";
import type { CoreTimeframe } from "@/lib/types/market";
import type { SymbolAnalysis } from "@/lib/types/scoring";
import { CandleChart } from "@/components/CandleChart";
import { formatNum, formatPct, formatPrice, signalClass } from "@/components/format";

export function SymbolDetail({
  row,
  onClose,
}: {
  row: SymbolAnalysis;
  onClose: () => void;
}) {
  const [tf, setTf] = useState<CoreTimeframe>("4h");
  const tfRows = useMemo(
    () => (["4h", "1h", "15m"] as const).map((key) => row.indicators[key]),
    [row],
  );

  return (
    <div className="fixed inset-0 z-40 flex items-end justify-end bg-black/50 p-0 sm:items-stretch sm:p-4">
      <div className="flex h-[92vh] w-full max-w-3xl flex-col overflow-y-auto border-l border-zinc-800 bg-zinc-950 sm:h-auto sm:rounded-lg sm:border">
        <div className="flex items-start justify-between gap-3 border-b border-zinc-800 px-4 py-3">
          <div>
            <h2 className="font-mono text-lg text-zinc-50">{row.display}</h2>
            <p className="text-xs text-zinc-500">
              {formatPrice(row.ticker?.last)} · {formatPct(row.ticker?.change24hPct)} · BTC corr{" "}
              {formatNum(row.btcCorrelation, 2)}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-zinc-700 px-2 py-1 text-xs text-zinc-300"
          >
            閉じる
          </button>
        </div>

        <div className="space-y-4 p-4">
          <div className="flex flex-wrap items-center gap-2">
            <span className={`rounded-md border px-3 py-1 text-sm font-semibold ${signalClass(row.signal)}`}>
              {row.signal}
            </span>
            <span className="text-sm text-zinc-400">
              LONG {row.long?.total ?? "—"} / SHORT {row.short?.total ?? "—"} · Diff {row.difference ?? "—"}
            </span>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <ScorePanel title="LONG SCORE" score={row.long} accent="emerald" />
            <ScorePanel title="SHORT SCORE" score={row.short} accent="rose" />
          </div>

          {row.long ? (
            <section>
              <h3 className="text-sm font-semibold text-zinc-200">スコア内訳（LONG）</h3>
              <Breakdown items={row.long.items} total={row.long.total} />
            </section>
          ) : null}
          {row.short ? (
            <section>
              <h3 className="text-sm font-semibold text-zinc-200">スコア内訳（SHORT）</h3>
              <Breakdown items={row.short.items} total={row.short.total} />
            </section>
          ) : null}

          <CandleChart symbol={row.symbol} timeframe={tf} onTimeframe={setTf} />

          <table className="min-w-full text-left text-xs">
            <thead className="text-zinc-500">
              <tr>
                {["TF", "Trend", "RSI", "MACD", "ADX", "Vol", "Structure"].map((h) => (
                  <th key={h} className="py-1 pr-3 font-medium">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {tfRows.map((tfRow, idx) =>
                tfRow ? (
                  <tr key={tfRow.timeframe} className="border-t border-zinc-800">
                    <td className="py-1 pr-3 font-mono">{tfRow.timeframe.toUpperCase()}</td>
                    <td className="py-1 pr-3">{tfRow.trend}</td>
                    <td className="py-1 pr-3 font-mono">{formatNum(tfRow.rsi, 1)}</td>
                    <td className="py-1 pr-3">{tfRow.macdBias}</td>
                    <td className="py-1 pr-3 font-mono">{formatNum(tfRow.adx, 1)}</td>
                    <td className="py-1 pr-3 font-mono">{formatNum(tfRow.volumeRatio, 2)}</td>
                    <td className="py-1 pr-3 font-mono">{tfRow.structure}</td>
                  </tr>
                ) : (
                  <tr key={idx} className="border-t border-zinc-800">
                    <td className="py-1 text-zinc-500" colSpan={7}>
                      Missing timeframe
                    </td>
                  </tr>
                ),
              )}
            </tbody>
          </table>

          {row.notes.length ? (
            <ul className="list-disc space-y-1 pl-4 text-xs text-zinc-500">
              {row.notes.map((note) => (
                <li key={note}>{note}</li>
              ))}
            </ul>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function ScorePanel({
  title,
  score,
  accent,
}: {
  title: string;
  score: SymbolAnalysis["long"];
  accent: "emerald" | "rose";
}) {
  const color = accent === "emerald" ? "text-emerald-300" : "text-rose-300";
  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900/80 p-3">
      <div className="text-[11px] tracking-[0.16em] text-zinc-500">{title}</div>
      <div className={`mt-1 font-mono text-3xl font-semibold ${color}`}>
        {score ? score.total : "—"}
        <span className="ml-1 text-sm font-normal text-zinc-500">/ 100</span>
      </div>
    </div>
  );
}

function Breakdown({
  items,
  total,
}: {
  items: NonNullable<SymbolAnalysis["long"]>["items"];
  total: number;
}) {
  return (
    <div className="mt-2 grid gap-1">
      {items.map((item) => (
        <div key={item.key} className="grid grid-cols-[140px_70px_1fr] items-start gap-3 text-xs">
          <span className="text-zinc-400">{item.label}</span>
          <span className="font-mono text-zinc-100">
            {item.points > 0 ? `+${item.points}` : item.points} / {item.max}
          </span>
          <span className="text-zinc-500">{item.reason}</span>
        </div>
      ))}
      <div className="grid grid-cols-[140px_70px_1fr] gap-3 border-t border-zinc-800 pt-1 text-xs">
        <span className="font-semibold text-zinc-200">TOTAL</span>
        <span className="font-mono font-semibold">{total} / 100</span>
        <span />
      </div>
    </div>
  );
}
