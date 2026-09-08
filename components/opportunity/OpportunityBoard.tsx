"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { readApiJson } from "@/lib/client/api-json";
import { OpportunityCard } from "./OpportunityCard";
import { OpportunityDetail } from "./OpportunityDetail";
import type {
  BtcRegime,
  ExcludedSymbol,
  OpportunityRow,
  OpportunitySide,
  OpportunityVerdict,
} from "@/lib/types/opportunity";

type UniverseInfo = { total: number; batchSize: number };
type BatchResponse = {
  rows: OpportunityRow[];
  excluded: ExcludedSymbol[];
  btcRegime: BtcRegime;
  offset: number;
  total: number;
  updatedAt: string;
};

type TabId = "long" | "short" | "ev" | "up" | "down" | "rr";

const TABS: Array<{ id: TabId; label: string; hint: string }> = [
  { id: "long", label: "🔥 今すぐLONG", hint: "LONGのEntry判定順・時間当たり期待値順" },
  { id: "short", label: "🔥 今すぐSHORT", hint: "SHORTのEntry判定順・時間当たり期待値順" },
  { id: "ev", label: "💰 Expected Value", hint: "手数料・Funding控除後の推定期待値順" },
  { id: "up", label: "📈 上昇確率", hint: "LONG方向の利益到達確率順" },
  { id: "down", label: "📉 下落確率", hint: "SHORT方向の利益到達確率順" },
  { id: "rr", label: "⚖️ Risk / Reward", hint: "推奨TP ÷ 推奨SL（期待値プラスのみ）" },
];

const COVERAGE_OPTIONS = [48, 96, 168, 240, 0] as const;
const DISPLAY_OPTIONS = [30, 50, 100] as const;

const VERDICT_RANK: Record<OpportunityVerdict, number> = {
  "ENTER NOW": 0,
  "GOOD BUT WAIT": 1,
  "WAIT FOR PULLBACK": 2,
  "NO ENTRY": 3,
};

type Entry = { row: OpportunityRow; side: OpportunitySide };

function bestSide(row: OpportunityRow): OpportunitySide | null {
  if (row.long && row.short) {
    return row.long.expectedValuePerHourPct >= row.short.expectedValuePerHourPct
      ? row.long
      : row.short;
  }
  return row.long ?? row.short ?? null;
}

export function OpportunityBoard() {
  const [rows, setRows] = useState<OpportunityRow[]>([]);
  const [excluded, setExcluded] = useState<ExcludedSymbol[]>([]);
  const [regime, setRegime] = useState<BtcRegime | null>(null);
  const [universe, setUniverse] = useState<UniverseInfo | null>(null);
  const [scanning, setScanning] = useState(false);
  const [progress, setProgress] = useState({ done: 0, target: 0 });
  const [error, setError] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);

  const [tab, setTab] = useState<TabId>("ev");
  const [coverage, setCoverage] = useState<number>(96);
  const [displayCount, setDisplayCount] = useState<number>(30);
  const [minConfidence, setMinConfidence] = useState(40);
  const [positiveOnly, setPositiveOnly] = useState(true);
  const [openSymbol, setOpenSymbol] = useState<string | null>(null);
  const [showExcluded, setShowExcluded] = useState(false);

  const cancelRef = useRef(false);

  useEffect(() => {
    let active = true;
    fetch("/api/opportunities")
      .then((response) => readApiJson<UniverseInfo>(response, "GET /api/opportunities"))
      .then((info) => {
        if (active) setUniverse(info);
      })
      .catch((cause) => {
        if (active) setError(cause instanceof Error ? cause.message : String(cause));
      });
    return () => {
      active = false;
    };
  }, []);

  const runScan = useCallback(async () => {
    if (!universe) return;
    cancelRef.current = false;
    setScanning(true);
    setError(null);
    setRows([]);
    setExcluded([]);
    setOpenSymbol(null);

    const target = coverage === 0 ? universe.total : Math.min(coverage, universe.total);
    setProgress({ done: 0, target });

    try {
      for (let offset = 0; offset < target; offset += universe.batchSize) {
        if (cancelRef.current) break;
        const limit = Math.min(universe.batchSize, target - offset);
        const response = await fetch("/api/opportunities", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ offset, limit }),
        });
        const batch = await readApiJson<BatchResponse>(
          response,
          `POST /api/opportunities offset=${offset}`,
        );
        if (cancelRef.current) break;
        setRows((current) => [...current, ...batch.rows]);
        setExcluded((current) => [...current, ...batch.excluded]);
        setRegime(batch.btcRegime);
        setUpdatedAt(batch.updatedAt);
        setProgress({ done: Math.min(offset + limit, target), target });
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setScanning(false);
    }
  }, [coverage, universe]);

  const entries = useMemo<Entry[]>(() => {
    const pass = (side: OpportunitySide) =>
      side.confidence >= minConfidence && (!positiveOnly || side.expectedValuePct > 0);

    const collect = (pick: (row: OpportunityRow) => OpportunitySide | null): Entry[] =>
      rows.flatMap((row) => {
        const side = pick(row);
        return side && pass(side) ? [{ row, side }] : [];
      });

    switch (tab) {
      case "long":
        return collect((row) => row.long).sort(
          (a, b) =>
            VERDICT_RANK[a.side.verdict] - VERDICT_RANK[b.side.verdict] ||
            b.side.expectedValuePerHourPct - a.side.expectedValuePerHourPct,
        );
      case "short":
        return collect((row) => row.short).sort(
          (a, b) =>
            VERDICT_RANK[a.side.verdict] - VERDICT_RANK[b.side.verdict] ||
            b.side.expectedValuePerHourPct - a.side.expectedValuePerHourPct,
        );
      case "up":
        return collect((row) => row.long).sort(
          (a, b) => b.side.profitProbability - a.side.profitProbability,
        );
      case "down":
        return collect((row) => row.short).sort(
          (a, b) => b.side.profitProbability - a.side.profitProbability,
        );
      case "rr":
        return collect(bestSide)
          .filter((entry) => entry.side.expectedValuePct > 0)
          .sort((a, b) => b.side.rewardRisk - a.side.rewardRisk);
      default:
        return collect(bestSide).sort(
          (a, b) => b.side.expectedValuePct - a.side.expectedValuePct,
        );
    }
  }, [minConfidence, positiveOnly, rows, tab]);

  const visible = entries.slice(0, displayCount);
  const openRow = openSymbol ? rows.find((row) => row.symbol === openSymbol) ?? null : null;
  const enterNow = rows.filter(
    (row) => row.long?.verdict === "ENTER NOW" || row.short?.verdict === "ENTER NOW",
  ).length;

  return (
    <main className="mx-auto max-w-7xl space-y-4 px-4 py-5">
      <header className="space-y-2">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <div>
            <h1 className="text-base font-semibold tracking-[0.14em] text-zinc-100">
              ENTRY NOW BOARD
            </h1>
            <p className="mt-1 text-[11px] leading-5 text-zinc-500">
              いま各銘柄にエントリーした場合、短時間でどこまで伸びる可能性があるかを、LONG /
              SHORT独立に推定します。表示している確率は過去データと現在の市場状態からの推定値で、
              将来を保証するものではありません。
            </p>
          </div>
          <nav className="flex gap-2 text-[11px]">
            <Link
              href="/analysis"
              className="rounded border border-zinc-700 px-2 py-1 text-zinc-400 hover:bg-zinc-800"
            >
              詳細分析（旧画面）
            </Link>
            <Link
              href="/simulation"
              className="rounded border border-zinc-700 px-2 py-1 text-zinc-400 hover:bg-zinc-800"
            >
              Simulation
            </Link>
          </nav>
        </div>

        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-zinc-800 bg-zinc-900/60 p-3 text-[11px]">
          <button
            type="button"
            onClick={scanning ? () => (cancelRef.current = true) : runScan}
            disabled={!universe}
            className={`rounded px-3 py-1.5 font-semibold tracking-[0.1em] ${
              scanning
                ? "bg-rose-500/20 text-rose-200 hover:bg-rose-500/30"
                : "bg-emerald-500/20 text-emerald-200 hover:bg-emerald-500/30 disabled:opacity-40"
            }`}
          >
            {scanning ? "中断" : "SCAN"}
          </button>

          <label className="text-zinc-500">
            評価銘柄数
            <select
              value={coverage}
              onChange={(event) => setCoverage(Number(event.target.value))}
              disabled={scanning}
              className="ml-1 rounded border border-zinc-700 bg-zinc-900 px-1 py-0.5 text-zinc-200"
            >
              {COVERAGE_OPTIONS.map((option) => (
                <option key={option} value={option}>
                  {option === 0 ? `全 ${universe?.total ?? "?"} 銘柄` : `上位 ${option}`}
                </option>
              ))}
            </select>
          </label>

          <label className="text-zinc-500">
            表示件数
            <select
              value={displayCount}
              onChange={(event) => setDisplayCount(Number(event.target.value))}
              className="ml-1 rounded border border-zinc-700 bg-zinc-900 px-1 py-0.5 text-zinc-200"
            >
              {DISPLAY_OPTIONS.map((option) => (
                <option key={option} value={option}>
                  上位 {option}
                </option>
              ))}
            </select>
          </label>

          <label className="text-zinc-500">
            Confidence下限 {minConfidence}
            <input
              type="range"
              min={0}
              max={90}
              step={5}
              value={minConfidence}
              onChange={(event) => setMinConfidence(Number(event.target.value))}
              className="ml-2 w-28 align-middle"
            />
          </label>

          <label className="flex items-center gap-1 text-zinc-500">
            <input
              type="checkbox"
              checked={positiveOnly}
              onChange={(event) => setPositiveOnly(event.target.checked)}
            />
            期待値プラスのみ
          </label>

          <span className="ml-auto text-zinc-500">
            {scanning
              ? `評価中 ${progress.done} / ${progress.target}`
              : rows.length > 0
                ? `評価済 ${rows.length} 銘柄 ・ ENTER NOW ${enterNow} 件`
                : universe
                  ? `対象 ${universe.total} 銘柄`
                  : "読み込み中"}
          </span>
        </div>

        {regime && <p className="text-[11px] text-zinc-500">{regime.label}</p>}
        {error && (
          <p className="rounded border border-rose-500/40 bg-rose-500/10 px-2 py-1 text-[11px] text-rose-200">
            {error}
          </p>
        )}
      </header>

      <nav className="flex flex-wrap gap-1.5">
        {TABS.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => setTab(item.id)}
            title={item.hint}
            className={`rounded border px-2 py-1 text-[11px] ${
              tab === item.id
                ? "border-zinc-500 bg-zinc-800 text-zinc-100"
                : "border-zinc-800 text-zinc-400 hover:bg-zinc-900"
            }`}
          >
            {item.label}
          </button>
        ))}
      </nav>
      <p className="text-[10px] text-zinc-500">
        {TABS.find((item) => item.id === tab)?.hint} ・ 該当 {entries.length} 件中 {visible.length}{" "}
        件を表示
      </p>

      {openRow && (
        <OpportunityDetail row={openRow} onClose={() => setOpenSymbol(null)} />
      )}

      {visible.length === 0 ? (
        <p className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-4 text-center text-[12px] text-zinc-500">
          {rows.length === 0
            ? "SCANを実行してください。"
            : "この条件を満たす候補はありません。無理に選ばないことも正常な結果です。"}
        </p>
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {visible.map((entry) => (
            <OpportunityCard
              key={`${entry.row.symbol}-${entry.side.direction}`}
              row={entry.row}
              side={entry.side}
              onOpen={() => setOpenSymbol(entry.row.symbol)}
            />
          ))}
        </div>
      )}

      {excluded.length > 0 && (
        <section className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-3">
          <button
            type="button"
            onClick={() => setShowExcluded((current) => !current)}
            className="text-[11px] text-zinc-400 hover:text-zinc-200"
          >
            データ不足で除外 {excluded.length} 件 {showExcluded ? "▲" : "▼"}
          </button>
          {showExcluded && (
            <ul className="mt-2 space-y-0.5 text-[10px] text-zinc-500">
              {excluded.map((item) => (
                <li key={item.symbol}>
                  <span className="font-mono text-zinc-400">{item.symbol}</span> — {item.reason}
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      <footer className="space-y-1 text-[10px] leading-5 text-zinc-500">
        <p>
          利益到達確率が高いことだけでEntry推奨にはしていません。Expected Value・推奨SL・
          ボラティリティ・推奨レバレッジ・BTC Market Regimeを合わせて判定しています。
        </p>
        <p>
          期待値は往復のTaker手数料・想定Slippage・保有時間分のFundingを控除した推定値です。
          実際の約定価格・手数料・資金調達率は取引所と時点により異なります。
        </p>
        {updatedAt && <p>最終更新 {new Date(updatedAt).toLocaleString("ja-JP")}</p>}
      </footer>
    </main>
  );
}
