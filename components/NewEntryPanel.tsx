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
      const entry = direction === "LONG" ? row.long?.total : row.short?.total;
      const timing = direction === "LONG" ? row.timing?.long : row.timing?.short;
      if (
        entry == null ||
        timing == null ||
        entry < settings.entryThreshold ||
        timing < settings.timingThreshold
      ) return [];
      return [{ row, direction, entry, timing }];
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
          Entry {settings.entryThreshold}+ / Timing {settings.timingThreshold}+ / RANGE除外
        </p>
      </div>
      <div className="mt-3 grid gap-2 md:grid-cols-2 xl:grid-cols-3">
        {entries.length ? entries.map(({ row, direction, entry, timing }) => (
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
          </button>
        )) : (
          <p className="text-xs text-zinc-500">現在、設定条件を満たす候補はありません。</p>
        )}
      </div>
    </section>
  );
}
