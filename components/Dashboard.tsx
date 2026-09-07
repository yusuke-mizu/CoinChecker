"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { HIGH_BTC_CORR } from "@/lib/correlation/pearson";
import { computeMarketRisk } from "@/lib/scoring/market-risk";
import { applyRanks, topLong, topShort } from "@/lib/scoring/ranking";
import { DATA_SOURCE_NOTES, DISCLAIMER } from "@/lib/analysis/notes";
import type { TickerSnapshot } from "@/lib/types/market";
import type {
  MarketEnvSnapshot,
  MarketRisk,
  SymbolAnalysis,
} from "@/lib/types/scoring";
import { SymbolDetail } from "@/components/SymbolDetail";
import {
  formatCorr,
  formatNum,
  formatPct,
  formatPrice,
  riskClass,
  signalClass,
} from "@/components/format";

const BATCH_SIZE = 8;
const REFRESH_OPTIONS = [
  { label: "OFF", value: 0 },
  { label: "5分", value: 5 },
  { label: "15分", value: 15 },
  { label: "30分", value: 30 },
] as const;

type SortKey =
  | "rankLong"
  | "symbol"
  | "price"
  | "change"
  | "long"
  | "short"
  | "diff"
  | "trend4h"
  | "rsi4h"
  | "adx"
  | "corr"
  | "signal";

type UniverseResponse = {
  symbols: string[];
  tickers: Record<string, TickerSnapshot>;
  btccCount: number;
  skippedNoOkx: number;
  source: string;
  warning: string | null;
  error: string | null;
};

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function StatusCard({
  label,
  value,
  sub,
  subPositive,
}: {
  label: string;
  value: string;
  sub?: string | null;
  subPositive?: boolean;
}) {
  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900/80 p-4">
      <div className="text-[11px] tracking-[0.16em] text-zinc-500">{label}</div>
      <div className="mt-1 font-mono text-xl text-zinc-50">{value}</div>
      {sub ? (
        <div
          className={`mt-1 text-xs ${
            subPositive == null ? "text-zinc-500" : subPositive ? "text-emerald-400" : "text-rose-400"
          }`}
        >
          {sub}
        </div>
      ) : null}
    </div>
  );
}

export function Dashboard() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [rows, setRows] = useState<SymbolAnalysis[]>([]);
  const [market, setMarket] = useState<MarketEnvSnapshot | null>(null);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<"all" | "long" | "short" | "error">("all");
  const [sortKey, setSortKey] = useState<SortKey>("long");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [selected, setSelected] = useState<SymbolAnalysis | null>(null);
  const [refreshMin, setRefreshMin] = useState(0);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const abortRef = useRef(false);
  const runningRef = useRef(false);

  const ranked = useMemo(() => applyRanks(rows), [rows]);
  const risk: MarketRisk | null = useMemo(() => {
    if (!market && ranked.length === 0) return null;
    return computeMarketRisk({
      btc4h: market?.btc4h ?? ranked.find((r) => r.symbol === "BTCUSDT")?.indicators["4h"] ?? null,
      dominancePct: market?.dominancePct ?? null,
      correlations: ranked.map((r) => r.btcCorrelation),
    });
  }, [market, ranked]);

  const longs = useMemo(() => topLong(ranked, 5), [ranked]);
  const shorts = useMemo(() => topShort(ranked, 5), [ranked]);

  const visible = useMemo(() => {
    let next = ranked;
    const q = query.trim().toUpperCase();
    if (q) next = next.filter((r) => r.symbol.includes(q) || r.display.includes(q));
    if (filter === "long") next = next.filter((r) => (r.long?.total ?? 0) >= 60 && r.signal.includes("LONG"));
    if (filter === "short") next = next.filter((r) => (r.short?.total ?? 0) >= 60 && r.signal.includes("SHORT"));
    if (filter === "error") next = next.filter((r) => r.status !== "ok");
    const dir = sortDir === "asc" ? 1 : -1;
    return [...next].sort((a, b) => dir * compareRows(a, b, sortKey));
  }, [ranked, query, filter, sortKey, sortDir]);

  const runScan = useCallback(async () => {
    if (runningRef.current) return;
    runningRef.current = true;
    abortRef.current = false;
    setLoading(true);
    setError(null);
    setWarning(null);
    setRows([]);
    setSelected(null);
    setProgress({ done: 0, total: 0 });
    try {
      const [universeRes, envRes] = await Promise.all([
        fetch("/api/universe"),
        fetch("/api/market-env"),
      ]);
      const universe = (await universeRes.json()) as UniverseResponse & { error?: string };
      const env = (await envRes.json()) as MarketEnvSnapshot & { error?: string };
      if (!universeRes.ok) throw new Error(universe.error || "銘柄一覧の取得に失敗しました");
      if (!envRes.ok) throw new Error(env.error || "市場環境の取得に失敗しました");
      setMarket(env);
      if (universe.warning) setWarning(universe.warning);
      const symbols = universe.symbols;
      setProgress({ done: 0, total: symbols.length });
      const collected: SymbolAnalysis[] = [];
      for (let i = 0; i < symbols.length; i += BATCH_SIZE) {
        if (abortRef.current) break;
        const batch = symbols.slice(i, i + BATCH_SIZE);
        const tickers: Record<string, TickerSnapshot> = {};
        for (const symbol of batch) {
          const snap = universe.tickers[symbol];
          if (snap) tickers[symbol] = snap;
        }
        const response = await fetch("/api/analyze-batch", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            symbols: batch,
            btc4h: env.btc4h,
            btc1hCloses: env.btc1hCloses,
            dominancePct: env.dominancePct,
            tickers,
          }),
        });
        const json = (await response.json()) as { results?: SymbolAnalysis[]; error?: string };
        if (!response.ok) {
          for (const symbol of batch) {
            collected.push({
              symbol,
              display: symbol,
              status: "DATA_ERROR",
              ticker: tickers[symbol] ?? null,
              long: null,
              short: null,
              difference: null,
              bias: null,
              signal: "DATA ERROR",
              indicators: {},
              updatedAt: new Date().toISOString(),
              notes: [json.error || "Batch failed"],
              dataSource: "okx-swap-public",
              btcCorrelation: null,
              rankLong: null,
              rankShort: null,
            });
          }
        } else {
          collected.push(...(json.results ?? []));
        }
        setRows([...collected]);
        setProgress({ done: collected.length, total: symbols.length });
        if (i + BATCH_SIZE < symbols.length) await sleep(350);
      }
      setUpdatedAt(new Date().toISOString());
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      runningRef.current = false;
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!refreshMin) return;
    const id = window.setInterval(() => {
      void runScan();
    }, refreshMin * 60_000);
    return () => window.clearInterval(id);
  }, [refreshMin, runScan]);

  function toggleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir(key === "symbol" || key === "signal" || key === "trend4h" ? "asc" : "desc");
    }
  }

  const btc = market?.btc;

  return (
    <div className="mx-auto flex w-full max-w-[1400px] flex-col gap-5 px-4 py-6 lg:px-6">
      <header className="flex flex-col gap-3 border-b border-zinc-800 pb-5 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-xs font-medium tracking-[0.18em] text-zinc-500">
            DECISION SUPPORT · NO AUTO TRADING
          </p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight text-zinc-50">Coin Checker</h1>
          <p className="mt-1 max-w-3xl text-sm text-zinc-400">
            BTCC掲載USDT銘柄を動的取得し、その瞬間の4H / 1H / 15MからLONG/SHORTを別採点します。
            注文・決済・ポジション操作はありません。
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label className="text-xs text-zinc-500">
            自動更新
            <select
              value={String(refreshMin)}
              onChange={(e) => setRefreshMin(Number(e.target.value))}
              className="ml-2 h-10 rounded-md border border-zinc-700 bg-zinc-950 px-2 text-sm text-zinc-100"
            >
              {REFRESH_OPTIONS.map((opt) => (
                <option key={opt.label} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </label>
          {loading ? (
            <button
              type="button"
              onClick={() => {
                abortRef.current = true;
              }}
              className="h-10 rounded-md border border-zinc-600 px-4 text-sm text-zinc-200"
            >
              停止
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => void runScan()}
            disabled={loading}
            className="h-10 rounded-md bg-emerald-500 px-4 text-sm font-semibold text-zinc-950 hover:bg-emerald-400 disabled:cursor-wait disabled:opacity-60"
          >
            {loading ? "分析中..." : "分析開始"}
          </button>
        </div>
      </header>

      {error ? (
        <div className="rounded-md border border-rose-500/40 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
          {error}
        </div>
      ) : null}
      {warning ? (
        <div className="rounded-md border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
          {warning}
        </div>
      ) : null}

      {loading ? (
        <div className="rounded-lg border border-zinc-800 bg-zinc-900/60 px-5 py-4 text-sm text-zinc-300">
          <div className="flex items-center justify-between gap-3">
            <span>
              バッチ分析中 {progress.done} / {progress.total || "—"}（1銘柄の失敗で全体は止めません）
            </span>
            <span className="font-mono text-xs text-zinc-500">
              {progress.total ? `${Math.round((progress.done / progress.total) * 100)}%` : ""}
            </span>
          </div>
          <div className="mt-2 h-1.5 overflow-hidden rounded bg-zinc-800">
            <div
              className="h-full bg-emerald-400"
              style={{
                width: progress.total ? `${(progress.done / progress.total) * 100}%` : "4%",
              }}
            />
          </div>
        </div>
      ) : null}

      {!market && !loading && ranked.length === 0 ? (
        <div className="rounded-lg border border-dashed border-zinc-800 bg-zinc-900/40 px-5 py-10 text-center text-sm text-zinc-400">
          「分析開始」を押すと、その瞬間の市場データだけを取得してスコアリングします。DB保存はありません。
        </div>
      ) : null}

      {market || ranked.length ? (
        <>
          <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
            <StatusCard
              label="BTC PRICE"
              value={formatPrice(btc?.ticker?.last)}
              sub={formatPct(btc?.ticker?.change24hPct)}
              subPositive={(btc?.ticker?.change24hPct ?? 0) >= 0}
            />
            <StatusCard
              label="BTC 4H TREND"
              value={btc?.indicators["4h"]?.trend ?? "—"}
              sub={`RSI ${formatNum(btc?.indicators["4h"]?.rsi, 1)} · ADX ${formatNum(btc?.indicators["4h"]?.adx, 1)}`}
            />
            <StatusCard
              label="BTC DOMINANCE"
              value={market?.dominancePct != null ? `${market.dominancePct.toFixed(1)}%` : "—"}
              sub={market?.dominanceNote ?? "CoinGecko /global"}
            />
            <div className={`rounded-lg border p-4 ${risk ? riskClass(risk.level) : "border-zinc-800 bg-zinc-900/80"}`}>
              <div className="text-[11px] tracking-[0.16em] opacity-80">MARKET RISK</div>
              <div className="mt-1 font-mono text-xl">
                {risk ? `${risk.score} / 100` : "—"}
              </div>
              <div className="mt-1 text-xs">{risk?.level ?? ""} · 警告のみ</div>
            </div>
            <StatusCard
              label="UPDATED"
              value={updatedAt ? new Date(updatedAt).toLocaleTimeString() : "—"}
              sub={`${ranked.length} symbols · memory only`}
            />
          </section>

          {risk && risk.score >= 50 ? (
            <div className="rounded-md border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-100">
              {risk.warning} {risk.reasons.slice(0, 3).join(" / ")}
            </div>
          ) : null}

          <section className="grid gap-4 lg:grid-cols-2">
            <RankList title="TOP LONG" rows={longs} accent="emerald" onSelect={setSelected} />
            <RankList title="TOP SHORT" rows={shorts} accent="rose" onSelect={setSelected} />
          </section>

          <section className="flex flex-wrap items-center gap-2">
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="銘柄検索"
              className="h-9 w-40 rounded-md border border-zinc-700 bg-zinc-950 px-3 text-sm"
            />
            {(["all", "long", "short", "error"] as const).map((key) => (
              <button
                key={key}
                type="button"
                onClick={() => setFilter(key)}
                className={`h-9 rounded-md px-3 text-xs ${
                  filter === key ? "bg-zinc-100 text-zinc-950" : "border border-zinc-700 text-zinc-400"
                }`}
              >
                {key === "all" ? "ALL" : key === "long" ? "LONG候補" : key === "short" ? "SHORT候補" : "DATA ERROR"}
              </button>
            ))}
          </section>

          <section className="overflow-x-auto rounded-lg border border-zinc-800">
            <table className="min-w-[1200px] w-full text-left text-xs">
              <thead className="bg-zinc-900 text-[11px] uppercase tracking-wide text-zinc-500">
                <tr>
                  <Th label="Rank" onClick={() => toggleSort("rankLong")} />
                  <Th label="Symbol" onClick={() => toggleSort("symbol")} />
                  <Th label="Price" onClick={() => toggleSort("price")} />
                  <Th label="24h" onClick={() => toggleSort("change")} />
                  <Th label="LONG" onClick={() => toggleSort("long")} />
                  <Th label="SHORT" onClick={() => toggleSort("short")} />
                  <Th label="Diff" onClick={() => toggleSort("diff")} />
                  <Th label="4H" onClick={() => toggleSort("trend4h")} />
                  <th className="px-2 py-2 font-medium">1H</th>
                  <th className="px-2 py-2 font-medium">15M</th>
                  <Th label="RSI4H" onClick={() => toggleSort("rsi4h")} />
                  <th className="px-2 py-2 font-medium">RSI1H</th>
                  <th className="px-2 py-2 font-medium">RSI15</th>
                  <th className="px-2 py-2 font-medium">MACD</th>
                  <Th label="ADX" onClick={() => toggleSort("adx")} />
                  <th className="px-2 py-2 font-medium">Vol</th>
                  <Th label="BTC corr" onClick={() => toggleSort("corr")} />
                  <Th label="Signal" onClick={() => toggleSort("signal")} />
                  <th className="px-2 py-2 font-medium">Updated</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((row) => {
                  const highCorr =
                    row.btcCorrelation != null && Math.abs(row.btcCorrelation) >= HIGH_BTC_CORR;
                  return (
                    <tr
                      key={row.symbol}
                      onClick={() => setSelected(row)}
                      className="cursor-pointer border-t border-zinc-800 hover:bg-zinc-900/80"
                    >
                      <td className="px-2 py-2 font-mono">{row.rankLong ?? "—"}</td>
                      <td className="px-2 py-2 font-mono text-zinc-100">{row.display}</td>
                      <td className="px-2 py-2 font-mono">{formatPrice(row.ticker?.last)}</td>
                      <td
                        className={`px-2 py-2 font-mono ${
                          (row.ticker?.change24hPct ?? 0) >= 0 ? "text-emerald-400" : "text-rose-400"
                        }`}
                      >
                        {formatPct(row.ticker?.change24hPct)}
                      </td>
                      <td className="px-2 py-2 font-mono text-emerald-300">{row.long?.total ?? "—"}</td>
                      <td className="px-2 py-2 font-mono text-rose-300">{row.short?.total ?? "—"}</td>
                      <td className="px-2 py-2 font-mono">{row.difference ?? "—"}</td>
                      <td className="px-2 py-2">{row.indicators["4h"]?.trend ?? "—"}</td>
                      <td className="px-2 py-2">{row.indicators["1h"]?.trend ?? "—"}</td>
                      <td className="px-2 py-2">{row.indicators["15m"]?.trend ?? "—"}</td>
                      <td className="px-2 py-2 font-mono">{formatNum(row.indicators["4h"]?.rsi, 1)}</td>
                      <td className="px-2 py-2 font-mono">{formatNum(row.indicators["1h"]?.rsi, 1)}</td>
                      <td className="px-2 py-2 font-mono">{formatNum(row.indicators["15m"]?.rsi, 1)}</td>
                      <td className="px-2 py-2">{row.indicators["1h"]?.macdBias ?? "—"}</td>
                      <td className="px-2 py-2 font-mono">{formatNum(row.indicators["4h"]?.adx, 1)}</td>
                      <td className="px-2 py-2 font-mono">{formatNum(row.indicators["15m"]?.volumeRatio, 2)}</td>
                      <td className={`px-2 py-2 font-mono ${highCorr ? "text-amber-300" : ""}`}>
                        {formatCorr(row.btcCorrelation)}
                        {highCorr ? " !" : ""}
                      </td>
                      <td className="px-2 py-2">
                        <span className={`rounded border px-1.5 py-0.5 text-[10px] ${signalClass(row.signal)}`}>
                          {row.signal}
                        </span>
                      </td>
                      <td className="px-2 py-2 text-zinc-500" suppressHydrationWarning>
                        {new Date(row.updatedAt).toLocaleTimeString()}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </section>

          <section className="text-xs leading-5 text-zinc-500">
            <p>{DISCLAIMER}</p>
            {DATA_SOURCE_NOTES.map((note) => (
              <p key={note}>• {note}</p>
            ))}
            {market?.notes.map((note) => (
              <p key={note}>• {note}</p>
            ))}
          </section>
        </>
      ) : null}

      {selected ? (
        <SymbolDetail
          row={ranked.find((r) => r.symbol === selected.symbol) ?? selected}
          onClose={() => setSelected(null)}
        />
      ) : null}
    </div>
  );
}

function Th({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <th className="px-2 py-2 font-medium">
      <button type="button" onClick={onClick} className="hover:text-zinc-200">
        {label}
      </button>
    </th>
  );
}

function RankList({
  title,
  rows,
  accent,
  onSelect,
}: {
  title: string;
  rows: SymbolAnalysis[];
  accent: "emerald" | "rose";
  onSelect: (row: SymbolAnalysis) => void;
}) {
  const color = accent === "emerald" ? "text-emerald-300" : "text-rose-300";
  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900/70 p-4">
      <h2 className="text-sm font-semibold tracking-wide text-zinc-200">{title}</h2>
      <div className="mt-3 space-y-2">
        {rows.length === 0 ? (
          <p className="text-xs text-zinc-500">まだランキングを作るデータがありません。</p>
        ) : (
          rows.map((row, index) => (
            <button
              key={row.symbol}
              type="button"
              onClick={() => onSelect(row)}
              className="flex w-full items-center justify-between rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-left hover:border-zinc-600"
            >
              <span className="flex items-center gap-3">
                <span className="w-5 font-mono text-xs text-zinc-500">{index + 1}</span>
                <span className="font-mono text-sm">{row.display}</span>
                <span className={`rounded border px-1.5 py-0.5 text-[10px] ${signalClass(row.signal)}`}>
                  {row.signal}
                </span>
              </span>
              <span className={`font-mono text-sm ${color}`}>
                {accent === "emerald" ? row.long?.total : row.short?.total}
              </span>
            </button>
          ))
        )}
      </div>
    </div>
  );
}

function compareRows(a: SymbolAnalysis, b: SymbolAnalysis, key: SortKey): number {
  switch (key) {
    case "rankLong":
      return (a.rankLong ?? 9999) - (b.rankLong ?? 9999);
    case "symbol":
      return a.symbol.localeCompare(b.symbol);
    case "price":
      return (a.ticker?.last ?? -1) - (b.ticker?.last ?? -1);
    case "change":
      return (a.ticker?.change24hPct ?? -999) - (b.ticker?.change24hPct ?? -999);
    case "long":
      return (a.long?.total ?? -1) - (b.long?.total ?? -1);
    case "short":
      return (a.short?.total ?? -1) - (b.short?.total ?? -1);
    case "diff":
      return (a.difference ?? 0) - (b.difference ?? 0);
    case "trend4h":
      return (a.indicators["4h"]?.trend ?? "").localeCompare(b.indicators["4h"]?.trend ?? "");
    case "rsi4h":
      return (a.indicators["4h"]?.rsi ?? -1) - (b.indicators["4h"]?.rsi ?? -1);
    case "adx":
      return (a.indicators["4h"]?.adx ?? -1) - (b.indicators["4h"]?.adx ?? -1);
    case "corr":
      return (a.btcCorrelation ?? -2) - (b.btcCorrelation ?? -2);
    case "signal":
      return a.signal.localeCompare(b.signal);
    default:
      return 0;
  }
}