"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { HIGH_BTC_CORR } from "@/lib/correlation/pearson";
import { computeMarketRisk } from "@/lib/scoring/market-risk";
import { applyRanks, topLong, topReversal, topShort, topTiming } from "@/lib/scoring/ranking";
import { DATA_SOURCE_NOTES, DISCLAIMER } from "@/lib/analysis/notes";
import { failedCandidateAnalysis, listedWithoutPublicPerp } from "@/lib/analysis/listed-only";
import { readApiJson } from "@/lib/client/api-json";
import type { BtccCandidate, TickerSnapshot, PerpetualContract } from "@/lib/types/market";
import type { CandleVenue } from "@/lib/types/venue";
import type {
  MarketEnvSnapshot,
  MarketRisk,
  SymbolAnalysis,
} from "@/lib/types/scoring";
import { SymbolDetail } from "@/components/SymbolDetail";
import { TradeDesk } from "@/components/TradeDesk";
import { BtccUniverseTable } from "@/components/BtccUniverseTable";
import {
  adviceFor,
  macdJa,
  reversalJa,
  riskJa,
  signalJa,
  trendJa,
} from "@/lib/copy/ja";
import {
  formatCorr,
  formatNum,
  formatPct,
  formatPrice,
  riskClass,
  signalClass,
} from "@/components/format";

// Keep each Worker request below the upstream rate-limit and timeout budget.
const BATCH_SIZE = 3;
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
  candidates: BtccCandidate[];
  symbols: string[];
  tickers: Record<string, TickerSnapshot>;
  contracts?: Record<string, PerpetualContract>;
  btccCount: number;
  skippedNoOkx: number;
  skippedNoVenue?: number;
  venues?: Record<string, CandleVenue>;
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
  const [filter, setFilter] = useState<"all" | "long" | "short">("all");
  const [discoveryMode, setDiscoveryMode] = useState<"all" | "confirmed">("all");
  const [sortKey, setSortKey] = useState<SortKey>("long");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [selected, setSelected] = useState<SymbolAnalysis | null>(null);
  const [refreshMin, setRefreshMin] = useState(0);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [btccCount, setBtccCount] = useState<number | null>(null);
  const [contracts, setContracts] = useState<Record<string, PerpetualContract>>({});
  const [candidates, setCandidates] = useState<BtccCandidate[]>([]);
  const abortRef = useRef(false);
  const runningRef = useRef(false);

  const ranked = useMemo(() => applyRanks(rows), [rows]);
  const scoredRows = useMemo(
    () => ranked.filter((row) => row.availability === "SCORING_AVAILABLE" && row.rankingEligible),
    [ranked],
  );
  const analysisBySymbol = useMemo(
    () => new Map(ranked.map((row) => [row.symbol, row])),
    [ranked],
  );
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
  const timings = useMemo(() => topTiming(ranked, 5), [ranked]);
  const waiting = useMemo(
    () =>
      [...ranked]
        .filter((r) => r.setup?.kind === "ENTRY_WAIT")
        .slice(0, 5),
    [ranked],
  );
  const bullRev = useMemo(() => topReversal(ranked, "bullish", 5), [ranked]);
  const bearRev = useMemo(() => topReversal(ranked, "bearish", 5), [ranked]);

  const visible = useMemo(() => {
    let next = scoredRows;
    const q = query.trim().toUpperCase();
    if (q) next = next.filter((r) => r.symbol.includes(q) || r.display.includes(q));
    if (filter === "long") next = next.filter((r) => (r.long?.total ?? 0) >= 60 && r.signal.includes("LONG"));
    if (filter === "short") next = next.filter((r) => (r.short?.total ?? 0) >= 60 && r.signal.includes("SHORT"));
    const dir = sortDir === "asc" ? 1 : -1;
    return [...next].sort((a, b) => dir * compareRows(a, b, sortKey));
  }, [scoredRows, query, filter, sortKey, sortDir]);

  const runPhase13 = useCallback(async () => {
    if (runningRef.current) return;
    runningRef.current = true;
    abortRef.current = false;
    setLoading(true);
    setError(null);
    setWarning(null);
    setRows([]);
    setSelected(null);
    setProgress({ done: 0, total: 1 });
    try {
      // BTC-only must not wait for the paginated BTCC universe.
      const response = await fetch("/api/market-env");
      const json = await readApiJson<MarketEnvSnapshot & { error?: string }>(
        response,
        "GET /api/market-env",
      );
      if (!response.ok) throw new Error(json.error || "BTC分析の取得に失敗しました");
      if (!json.btc) throw new Error("BTC分析データがありません");
      setMarket(json);
      setRows([json.btc]);
      setSelected(json.btc);
      setProgress({ done: 1, total: 1 });
      setUpdatedAt(new Date().toISOString());
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      runningRef.current = false;
      setLoading(false);
    }
  }, []);

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
      const universe = await readApiJson<UniverseResponse & { error?: string }>(
        universeRes,
        "GET /api/universe",
      );
      const env = await readApiJson<MarketEnvSnapshot & { error?: string }>(
        envRes,
        "GET /api/market-env",
      );
      if (!universeRes.ok) throw new Error(universe.error || "銘柄一覧の取得に失敗しました");
      if (!envRes.ok) throw new Error(env.error || "市場環境の取得に失敗しました");
      setMarket(env);
      setCandidates(universe.candidates ?? []);
      if (universe.warning) setWarning(universe.warning);
      if (universe.contracts) setContracts(universe.contracts);
      setBtccCount(universe.btccCount);
      const skipped = universe.skippedNoVenue ?? universe.skippedNoOkx;
      if (skipped) {
        setWarning(universe.warning);
      }
      const symbols = universe.symbols;
      const venues = universe.venues ?? {};
      const candidateBySymbol = new Map(
        (universe.candidates ?? []).map((candidate) => [candidate.symbol, candidate]),
      );
      const listedOnly = symbols.filter((s) => !venues[s]);
      const toScore = symbols.filter((s) => venues[s]);
      setProgress({ done: 0, total: symbols.length });
      const collected: SymbolAnalysis[] = listedOnly.map((symbol) =>
        listedWithoutPublicPerp(
          symbol,
          universe.tickers[symbol] ?? null,
          candidateBySymbol.get(symbol),
        ),
      );
      setRows([...collected]);
      setProgress({ done: collected.length, total: symbols.length });
      for (let i = 0; i < toScore.length; i += BATCH_SIZE) {
        if (abortRef.current) break;
        const batch = toScore.slice(i, i + BATCH_SIZE);
        const tickers: Record<string, TickerSnapshot> = {};
        const batchCandidates: Record<string, BtccCandidate> = {};
        for (const symbol of batch) {
          const snap = universe.tickers[symbol];
          if (snap) tickers[symbol] = snap;
          const candidate = candidateBySymbol.get(symbol);
          if (candidate) batchCandidates[symbol] = candidate;
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
            venues: universe.venues,
            candidates: batchCandidates,
          }),
        });
        const json = await readApiJson<{ results?: SymbolAnalysis[]; error?: string }>(
          response,
          "POST /api/analyze-batch",
        );
        if (!response.ok) {
          for (const symbol of batch) {
            collected.push(failedCandidateAnalysis({
              symbol,
              ticker: tickers[symbol] ?? null,
              candidate: candidateBySymbol.get(symbol),
              venue: venues[symbol],
              error: json.error || "Batch failed",
            }));
          }
        } else {
          collected.push(
            ...(json.results ?? []).map((row) => {
              const c = universe.contracts?.[row.symbol];
              if (!c) return row;
              return {
                ...row,
                contract: {
                  contractType: c.contractType,
                  quoteAsset: c.quoteAsset,
                  marginAsset: c.marginAsset,
                  settlement: c.settlement,
                  maxLeverage: c.maxLeverage,
                },
              };
            }),
          );
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
            {market?.dataSourceLabel ?? "DATA SOURCE: OKX / TEST MODE"}
          </p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight text-zinc-50">Coin Checker</h1>
          <p className="mt-1 max-w-3xl text-sm text-zinc-400">
            銘柄の強さ（ENTRY）と今のタイミングは別点です。注文・決済はしません。点は一致度であり、上昇確率ではありません。
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
            onClick={() => void runPhase13()}
            disabled={loading}
            className="h-10 rounded-md border border-zinc-600 px-4 text-sm text-zinc-200 hover:border-zinc-400 disabled:cursor-wait disabled:opacity-60"
          >
            BTCのみ
          </button>
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

      {!market && !loading && ranked.length === 0 && candidates.length === 0 ? (
        <div className="rounded-lg border border-dashed border-zinc-800 bg-zinc-900/40 px-5 py-10 text-center text-sm text-zinc-400">
          「分析開始」でBTCC候補を発見し、同名の補完市場データが十分な銘柄だけを採点します。DB保存はありません。
        </div>
      ) : null}

      {market || ranked.length ? (
        <>
          <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-6">
            <StatusCard
              label="BTC PRICE"
              value={formatPrice(btc?.ticker?.last)}
              sub={formatPct(btc?.ticker?.change24hPct)}
              subPositive={(btc?.ticker?.change24hPct ?? 0) >= 0}
            />
            <StatusCard
              label="MARKET REGIME"
              value={btc?.regime?.regime ?? "—"}
              sub={`Trend ${btc?.regime?.trendScore ?? "—"} · Range ${btc?.regime?.rangeScore ?? "—"} · Drift ${btc?.regime?.driftScore ?? "—"}`}
            />
            <StatusCard
              label="BTC 4時間"
              value={trendJa(btc?.indicators["4h"]?.trend)}
              sub={`RSI ${formatNum(btc?.indicators["4h"]?.rsi, 1)} · ADX ${formatNum(btc?.indicators["4h"]?.adx, 1)}`}
            />
            <StatusCard
              label="BTC DOMINANCE"
              value={market?.dominancePct != null ? `${market.dominancePct.toFixed(1)}%` : "—"}
              sub={market?.dominanceNote ?? "CoinGecko /global"}
            />
            <StatusCard label="DXY / NASDAQ / 10Y" value="—" sub="公式の無料API未配線（0点）" />
            <div className={`rounded-lg border p-4 ${risk ? riskClass(risk.level) : "border-zinc-800 bg-zinc-900/80"}`}>
              <div className="text-[11px] tracking-[0.16em] opacity-80">市場リスク</div>
              <div className="mt-1 font-mono text-xl">
                {risk ? `${risk.score} / 100` : "—"}
              </div>
              <div className="mt-1 text-xs">{risk ? riskJa(risk.level) : ""} · 警告のみ（自動停止なし）</div>
            </div>
            <StatusCard
              label="UPDATED"
              value={updatedAt ? new Date(updatedAt).toLocaleTimeString() : "—"}
              sub={`${scoredRows.length} scoring available · BTCC候補 ${btccCount ?? "—"} · memory only`}
            />
          </section>

          {candidates.length ? (
            <BtccUniverseTable
              candidates={candidates}
              analyses={analysisBySymbol}
              mode={discoveryMode}
              onMode={setDiscoveryMode}
              onSelect={setSelected}
            />
          ) : null}

          {risk && risk.score >= 41 ? (
            <div className="rounded-md border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-100">
              {risk.warning} {risk.reasons.slice(0, 3).join(" / ")}
            </div>
          ) : null}

          <section className="grid gap-4 lg:grid-cols-2">
            <RankList title="買い候補 TOP" rows={longs} accent="emerald" onSelect={setSelected} />
            <RankList title="売り候補 TOP" rows={shorts} accent="rose" onSelect={setSelected} />
          </section>
          <section className="grid gap-4 lg:grid-cols-2">
            <RankList title="ENTRY TIMING が高い" rows={timings} accent="emerald" onSelect={setSelected} score="timing" />
            <RankList title="ENTRY WAIT（強いが今は待つ）" rows={waiting} accent="rose" onSelect={setSelected} score="timing" />
          </section>
          <section className="grid gap-4 lg:grid-cols-2">
            <RankList title="反転↑（売り持ち注意）" rows={bullRev} accent="emerald" onSelect={setSelected} score="revBull" />
            <RankList title="反転↓（買い持ち注意）" rows={bearRev} accent="rose" onSelect={setSelected} score="revBear" />
          </section>

          <TradeDesk
            ranked={scoredRows}
            market={market}
            risk={risk}
            contracts={contracts}
            onSelect={setSelected}
          />

          <section className="flex flex-wrap items-center gap-2">
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="銘柄検索"
              className="h-9 w-40 rounded-md border border-zinc-700 bg-zinc-950 px-3 text-sm"
            />
            {(["all", "long", "short"] as const).map((key) => (
              <button
                key={key}
                type="button"
                onClick={() => setFilter(key)}
                className={`h-9 rounded-md px-3 text-xs ${
                  filter === key ? "bg-zinc-100 text-zinc-950" : "border border-zinc-700 text-zinc-400"
                }`}
              >
                {key === "all"
                  ? "全部"
                  : key === "long"
                    ? "買い候補"
                    : "売り候補"}
              </button>
            ))}
          </section>

          <section className="overflow-x-auto rounded-lg border border-zinc-800">
            <table className="min-w-[1200px] w-full text-left text-xs">
              <thead className="bg-zinc-900 text-[11px] uppercase tracking-wide text-zinc-500">
                <tr>
                  <Th label="順位" onClick={() => toggleSort("rankLong")} />
                  <Th label="銘柄" onClick={() => toggleSort("symbol")} />
                  <th className="px-2 py-2 font-medium">種類</th>
                  <Th label="価格" onClick={() => toggleSort("price")} />
                  <Th label="24h" onClick={() => toggleSort("change")} />
                  <Th label="買い点" onClick={() => toggleSort("long")} />
                  <Th label="売り点" onClick={() => toggleSort("short")} />
                  <th className="px-2 py-2 font-medium">タイミング</th>
                  <th className="px-2 py-2 font-medium">Regime</th>
                  <th className="px-2 py-2 font-medium">先物</th>
                  <Th label="4時間" onClick={() => toggleSort("trend4h")} />
                  <th className="px-2 py-2 font-medium">1時間</th>
                  <th className="px-2 py-2 font-medium">15分</th>
                  <Th label="RSI4H" onClick={() => toggleSort("rsi4h")} />
                  <th className="px-2 py-2 font-medium">RSI1H</th>
                  <th className="px-2 py-2 font-medium">RSI15</th>
                  <th className="px-2 py-2 font-medium">MACD</th>
                  <Th label="ADX" onClick={() => toggleSort("adx")} />
                  <th className="px-2 py-2 font-medium">Vol</th>
                  <Th label="BTC連動" onClick={() => toggleSort("corr")} />
                  <Th label="判定" onClick={() => toggleSort("signal")} />
                  <th className="px-2 py-2 font-medium">反転</th>
                  <th className="px-2 py-2 font-medium">だからこうした方がいい</th>
                  <th className="px-2 py-2 font-medium">更新</th>
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
                      <td className="px-2 py-2 text-[10px] text-zinc-500">
                        {row.contract?.contractType ?? "USDT-M Perp"}
                      </td>
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
                      <td className="px-2 py-2 font-mono">{row.timing?.score ?? "—"}</td>
                      <td className="px-2 py-2 text-[10px]">{row.regime?.regime ?? "—"}</td>
                      <td className="px-2 py-2 font-mono">{row.futures?.score ?? "—"}</td>
                      <td className="px-2 py-2">{trendJa(row.indicators["4h"]?.trend)}</td>
                      <td className="px-2 py-2">{trendJa(row.indicators["1h"]?.trend)}</td>
                      <td className="px-2 py-2">{trendJa(row.indicators["15m"]?.trend)}</td>
                      <td className="px-2 py-2 font-mono">{formatNum(row.indicators["4h"]?.rsi, 1)}</td>
                      <td className="px-2 py-2 font-mono">{formatNum(row.indicators["1h"]?.rsi, 1)}</td>
                      <td className="px-2 py-2 font-mono">{formatNum(row.indicators["15m"]?.rsi, 1)}</td>
                      <td className="px-2 py-2">{macdJa(row.indicators["1h"]?.macdBias)}</td>
                      <td className="px-2 py-2 font-mono">{formatNum(row.indicators["4h"]?.adx, 1)}</td>
                      <td className="px-2 py-2 font-mono">{formatNum(row.indicators["15m"]?.volumeRatio, 2)}</td>
                      <td className={`px-2 py-2 font-mono ${highCorr ? "text-amber-300" : ""}`}>
                        {formatCorr(row.btcCorrelation)}
                        {highCorr ? " !" : ""}
                      </td>
                      <td className="px-2 py-2">
                        <span className={`rounded border px-1.5 py-0.5 text-[10px] ${signalClass(row.signal)}`}>
                          {adviceFor(row).tag}
                        </span>
                      </td>
                      <td className="px-2 py-2 text-[10px] text-zinc-300">
                        {reversalJa(row.reversal?.signal)}
                      </td>
                      <td className="max-w-[220px] px-2 py-2 text-[11px] text-zinc-300">
                        {adviceFor(row).action}
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
  score = "entry",
}: {
  title: string;
  rows: SymbolAnalysis[];
  accent: "emerald" | "rose";
  onSelect: (row: SymbolAnalysis) => void;
  score?: "entry" | "revBull" | "revBear" | "timing";
}) {
  const color = accent === "emerald" ? "text-emerald-300" : "text-rose-300";
  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900/70 p-4">
      <h2 className="text-sm font-semibold tracking-wide text-zinc-200">{title}</h2>
      <div className="mt-3 space-y-2">
        {rows.length === 0 ? (
          <p className="text-xs text-zinc-500">まだランキングを作るデータがありません。</p>
        ) : (
          rows.map((row, index) => {
            const value =
              score === "revBull"
                ? row.reversal?.bullish
                : score === "revBear"
                  ? row.reversal?.bearish
                  : score === "timing"
                    ? row.timing?.score
                    : accent === "emerald"
                      ? row.long?.total
                      : row.short?.total;
            const badge =
              score === "timing"
                ? (row.timing?.label ?? adviceFor(row).tag)
                : score === "entry"
                  ? signalJa(row.signal)
                  : reversalJa(row.reversal?.signal);
            const tip = adviceFor(row);
            return (
            <button
              key={row.symbol}
              type="button"
              onClick={() => onSelect(row)}
              className="flex w-full flex-col gap-1 rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-left hover:border-zinc-600"
            >
              <span className="flex w-full items-center justify-between">
                <span className="flex items-center gap-3">
                  <span className="w-5 font-mono text-xs text-zinc-500">{index + 1}</span>
                  <span className="font-mono text-sm">{row.display}</span>
                  <span className={`rounded border px-1.5 py-0.5 text-[10px] ${signalClass(row.signal)}`}>
                    {badge}
                  </span>
                </span>
                <span className={`font-mono text-sm ${color}`}>{value}</span>
              </span>
              <span className="pl-8 text-[11px] leading-4 text-zinc-400">{tip.action}</span>
            </button>
            );
          })
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