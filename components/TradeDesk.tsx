"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { scoreExitAlert } from "@/lib/scoring/exit-alert";
import { computePositionMetrics } from "@/lib/scoring/pnl";
import { computePortfolioRisk } from "@/lib/scoring/portfolio";
import { formatPct, formatPrice, riskClass } from "@/components/format";
import { alertTypeJa, exitLevelJa, flagJa, reversalJa, sideJa, trendJa } from "@/lib/copy/ja";
import type { AppAlert, ManualPosition } from "@/lib/types/alerts";
import type { PerpetualContract } from "@/lib/types/market";
import type { MarketEnvSnapshot, MarketRisk, SymbolAnalysis } from "@/lib/types/scoring";

const DEDUPE_MS = 12 * 60_000;

function intensityFromScore(score: number, kind: AppAlert["type"]): AppAlert["intensity"] {
  if (kind === "EXIT") {
    if (score >= 85) return "CRITICAL";
    if (score >= 70) return "HIGH";
    if (score >= 50) return "WARNING";
    if (score >= 30) return "WATCH";
    return "INFO";
  }
  if (score >= 85) return "HIGH";
  if (score >= 80) return "WARNING";
  return "INFO";
}

export function TradeDesk({
  ranked,
  market,
  risk,
  contracts,
  onSelect,
}: {
  ranked: SymbolAnalysis[];
  market: MarketEnvSnapshot | null;
  risk: MarketRisk | null;
  contracts: Record<string, PerpetualContract>;
  onSelect: (row: SymbolAnalysis) => void;
}) {
  const [positions, setPositions] = useState<ManualPosition[]>([]);
  const [alerts, setAlerts] = useState<AppAlert[]>([]);
  const [toast, setToast] = useState<string | null>(null);
  const [form, setForm] = useState({
    symbol: "SOLUSDT",
    side: "LONG" as "LONG" | "SHORT",
    entry: "",
    size: "",
    leverage: "10",
  });
  const seen = useRef(new Map<string, number>());

  const bySymbol = useMemo(() => new Map(ranked.map((row) => [row.symbol, row])), [ranked]);

  const evaluated = useMemo(() => {
    return positions.map((pos) => {
      const row = bySymbol.get(pos.symbol);
      const current = row?.ticker?.last ?? null;
      const metrics = current != null ? computePositionMetrics({
        side: pos.side,
        entry: pos.entry,
        current,
        leverage: pos.leverage,
      }) : { priceChangePct: null, marginPnlPct: null, priceStopHit: false };
      const exit = row
        ? scoreExitAlert({
            side: pos.side,
            tf4h: row.indicators["4h"] ?? null,
            tf1h: row.indicators["1h"] ?? null,
            tf15m: row.indicators["15m"] ?? null,
            btc4h: market?.btc4h ?? null,
            futures: row.futures,
            priceChangePct: metrics.priceChangePct,
            reversalScore: pos.side === "LONG" ? row.reversal?.bearish : row.reversal?.bullish,
            trendScore: (row.long?.breakdown.trend4h ?? 0) + (row.long?.breakdown.trend1h ?? 0),
          })
        : null;
      return { pos, row, current, metrics, exit };
    });
  }, [positions, bySymbol, market]);

  const exitRanked = useMemo(
    () => [...evaluated].sort((a, b) => (b.exit?.score ?? -1) - (a.exit?.score ?? -1)),
    [evaluated],
  );

  const portfolio = useMemo(
    () =>
      computePortfolioRisk({
        sides: positions.map((p) => p.side),
        exits: evaluated.map((e) => e.exit).filter((e): e is NonNullable<typeof e> => e != null),
        btc4h: market?.btc4h ?? null,
        marketRisk: risk,
      }),
    [positions, evaluated, market, risk],
  );

  useEffect(() => {
    if (!ranked.length) return;
    const next: AppAlert[] = [];
    const now = Date.now();
    const push = (alert: Omit<AppAlert, "id" | "time">) => {
      const key = `${alert.symbol}:${alert.type}:${alert.title}`;
      const last = seen.current.get(key);
      if (last && now - last < DEDUPE_MS) return;
      seen.current.set(key, now);
      next.push({
        ...alert,
        id: `${key}-${now}`,
        time: new Date().toISOString(),
      });
    };

    for (const row of ranked) {
      if ((row.long?.total ?? 0) >= 80 && (row.difference ?? 0) > 12) {
        push({
          symbol: row.symbol,
          display: row.display,
          type: "ENTRY",
          score: row.long?.total ?? 0,
          intensity: intensityFromScore(row.long?.total ?? 0, "ENTRY"),
          title: "買い 強め（検討）",
          reasons: row.long?.items.slice(0, 4).map((i) => i.reason) ?? [],
        });
      }
      if ((row.short?.total ?? 0) >= 80 && (row.difference ?? 0) < -12) {
        push({
          symbol: row.symbol,
          display: row.display,
          type: "ENTRY",
          score: row.short?.total ?? 0,
          intensity: intensityFromScore(row.short?.total ?? 0, "ENTRY"),
          title: "売り 強め（検討）",
          reasons: row.short?.items.slice(0, 4).map((i) => i.reason) ?? [],
        });
      }
      if ((row.reversal?.bullish ?? 0) >= 80 && row.reversal?.signal === "BULLISH REVERSAL") {
        push({
          symbol: row.symbol,
          display: row.display,
          type: "REVERSAL",
          score: row.reversal.bullish,
          intensity: intensityFromScore(row.reversal.bullish, "REVERSAL"),
          title: "反転↑（売りの人は注意）",
          reasons: row.reversal.reasons,
        });
      }
      for (const flag of row.futures?.flags ?? []) {
        push({
          symbol: row.symbol,
          display: row.display,
          type: "REVERSAL",
          score: row.futures?.score ?? 0,
          intensity: flag.includes("EXPLOSION") || flag.includes("LIQUIDATION") ? "HIGH" : "WARNING",
          title: flagJa(flag),
          reasons: [row.futures?.narrativeJa ?? ""],
        });
      }
      if ((row.reversal?.bearish ?? 0) >= 80 && row.reversal?.signal === "BEARISH REVERSAL") {
        push({
          symbol: row.symbol,
          display: row.display,
          type: "REVERSAL",
          score: row.reversal.bearish,
          intensity: intensityFromScore(row.reversal.bearish, "REVERSAL"),
          title: "反転↓（買いの人は注意）",
          reasons: row.reversal.reasons,
        });
      }
    }

    for (const item of evaluated) {
      if (!item.exit || item.exit.score < 70) continue;
      const title = item.pos.side === "LONG" ? "買いポジ 決済を検討" : "売りポジ 決済を検討";
      push({
        symbol: item.pos.symbol,
        display: item.row?.display ?? item.pos.symbol,
        type: "EXIT",
        score: item.exit.score,
        intensity: intensityFromScore(item.exit.score, "EXIT"),
        title,
        reasons: item.exit.reasons,
      });
    }

    if (!next.length) return;
    setAlerts((prev) => [...next, ...prev].slice(0, 80));
    const top = next[0];
    setToast(`${top.title} · ${top.display} · ${top.score}`);
    const t = window.setTimeout(() => setToast(null), 6000);
    if (typeof Notification !== "undefined" && Notification.permission === "granted") {
      new Notification(top.title, { body: `${top.display} ${top.score}` });
    }
    return () => window.clearTimeout(t);
  }, [ranked, evaluated]);

  function addPosition() {
    const symbol = form.symbol.replace(/[-_/]/g, "").toUpperCase();
    const entry = Number(form.entry);
    const size = Number(form.size);
    const leverage = Number(form.leverage);
    if (!symbol.endsWith("USDT") || !Number.isFinite(entry) || entry <= 0) return;
    setPositions((prev) => [
      {
        id: `${symbol}-${Date.now()}`,
        symbol,
        side: form.side,
        entry,
        size: Number.isFinite(size) ? size : 0,
        leverage: Number.isFinite(leverage) && leverage > 0 ? leverage : 1,
      },
      ...prev,
    ]);
  }

  return (
    <div className="space-y-5">
      {toast ? (
        <div className="rounded-md border border-amber-400/40 bg-amber-400/10 px-4 py-2 text-sm text-amber-100">
          {toast}
        </div>
      ) : null}

      <section className="rounded-lg border border-zinc-800 bg-zinc-900/70 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold tracking-wide text-zinc-200">自分のポジション</h2>
          <button
            type="button"
            onClick={() => {
              void Notification.requestPermission();
            }}
            className="text-[11px] text-zinc-500 underline"
          >
            ブラウザ通知を許可
          </button>
        </div>
        <p className="mt-1 text-xs text-zinc-500">
          手動入力のみ。メモリ上だけ保持し、リロードで消えます。注文・決済はしません。価格10%逆行は損切りルール表示で、証拠金損益とは別です。
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <input
            value={form.symbol}
            onChange={(e) => setForm((f) => ({ ...f, symbol: e.target.value }))}
            placeholder="SOLUSDT"
            className="h-9 w-28 rounded-md border border-zinc-700 bg-zinc-950 px-2 font-mono text-xs"
          />
          <select
            value={form.side}
            onChange={(e) => setForm((f) => ({ ...f, side: e.target.value as "LONG" | "SHORT" }))}
            className="h-9 rounded-md border border-zinc-700 bg-zinc-950 px-2 text-xs"
          >
            <option value="LONG">買い</option>
            <option value="SHORT">売り</option>
          </select>
          <input
            value={form.entry}
            onChange={(e) => setForm((f) => ({ ...f, entry: e.target.value }))}
            placeholder="Entry"
            className="h-9 w-24 rounded-md border border-zinc-700 bg-zinc-950 px-2 font-mono text-xs"
          />
          <input
            value={form.size}
            onChange={(e) => setForm((f) => ({ ...f, size: e.target.value }))}
            placeholder="Size"
            className="h-9 w-20 rounded-md border border-zinc-700 bg-zinc-950 px-2 font-mono text-xs"
          />
          <input
            value={form.leverage}
            onChange={(e) => setForm((f) => ({ ...f, leverage: e.target.value }))}
            placeholder="Lev"
            className="h-9 w-16 rounded-md border border-zinc-700 bg-zinc-950 px-2 font-mono text-xs"
          />
          <button
            type="button"
            onClick={addPosition}
            className="h-9 rounded-md bg-zinc-100 px-3 text-xs font-semibold text-zinc-950"
          >
            ＋ 保有ポジションを追加
          </button>
        </div>

        {portfolio.total ? (
          <div className={`mt-3 rounded-md border px-3 py-2 text-xs ${riskClass(portfolio.level)}`}>
            買い {portfolio.longCount} / 売り {portfolio.shortCount} · 決済危険 {portfolio.highExitCount}/
            {portfolio.total} · {portfolio.message}
          </div>
        ) : null}

        <div className="mt-3 overflow-x-auto">
          <table className="min-w-[900px] w-full text-left text-xs">
            <thead className="text-[11px] uppercase text-zinc-500">
              <tr>
                {["銘柄", "向き", "建値", "現値", "価格%", "証拠金損益", "トレンド", "反転", "決済危険", ""].map(
                  (h) => (
                    <th key={h} className="py-1 pr-3 font-medium">
                      {h}
                    </th>
                  ),
                )}
              </tr>
            </thead>
            <tbody>
              {evaluated.length === 0 ? (
                <tr>
                  <td className="py-3 text-zinc-500" colSpan={10}>
                    保有は未入力です。
                  </td>
                </tr>
              ) : (
                evaluated.map((item) => (
                  <tr key={item.pos.id} className="border-t border-zinc-800">
                    <td className="py-2 font-mono">{item.row?.display ?? item.pos.symbol}</td>
                    <td>{sideJa(item.pos.side)}</td>
                    <td className="font-mono">{formatPrice(item.pos.entry)}</td>
                    <td className="font-mono">{formatPrice(item.current)}</td>
                    <td className="font-mono">{formatPct(item.metrics.priceChangePct)}</td>
                    <td className="font-mono">{formatPct(item.metrics.marginPnlPct)}</td>
                    <td>{trendJa(item.row?.indicators["4h"]?.trend)}</td>
                    <td>{reversalJa(item.row?.reversal?.signal)}</td>
                    <td className="font-mono">
                      {item.exit ? `${item.exit.score} ${exitLevelJa(item.exit.level)}` : "—"}
                    </td>
                    <td>
                      <button
                        type="button"
                        className="text-zinc-500"
                        onClick={() => setPositions((p) => p.filter((x) => x.id !== item.pos.id))}
                      >
                        削除
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        {evaluated.map((item) => {
          if (!item.exit || item.exit.score < 50) return null;
          const profit = (item.metrics.priceChangePct ?? 0) >= 0;
          return (
            <div key={`${item.pos.id}-note`} className="mt-2 rounded-md border border-zinc-800 px-3 py-2 text-xs text-zinc-300">
              {profit
                ? `利益 ${formatPct(item.metrics.priceChangePct)} · ${item.exit.headline} · 利益確定・縮小を検討（自動決済なし）`
                : `損失 ${formatPct(item.metrics.priceChangePct)} · 価格変動と証拠金損益 ${formatPct(item.metrics.marginPnlPct)} は別です。10%価格ストップまで ${item.metrics.priceStopHit ? "到達" : "未到達"}。`}
              <div className="mt-1 text-zinc-500">{item.exit.reasons.slice(0, 6).join(" / ")}</div>
            </div>
          );
        })}
      </section>

      <section className="rounded-lg border border-zinc-800 bg-zinc-900/70 p-4">
        <h2 className="text-sm font-semibold tracking-wide text-zinc-200">決済危険ランク</h2>
        <div className="mt-3 space-y-2">
          {exitRanked.length === 0 ? (
            <p className="text-xs text-zinc-500">保有を追加すると危険度順に並びます。</p>
          ) : (
            exitRanked.map((item, index) => (
              <button
                key={item.pos.id}
                type="button"
                onClick={() => item.row && onSelect(item.row)}
                className="flex w-full items-center justify-between rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-left"
              >
                <span className="font-mono text-sm">
                  {index + 1}. {item.row?.display ?? item.pos.symbol}
                </span>
                <span className="font-mono text-xs">
                  {item.exit?.score ?? "—"} {exitLevelJa(item.exit?.level)}
                </span>
              </button>
            ))
          )}
        </div>
      </section>

      <section className="rounded-lg border border-zinc-800 bg-zinc-900/70 p-4">
        <h2 className="text-sm font-semibold tracking-wide text-zinc-200">お知らせ</h2>
        <div className="mt-3 overflow-x-auto">
          <table className="min-w-[700px] w-full text-left text-xs">
            <thead className="text-[11px] uppercase text-zinc-500">
              <tr>
                {["時刻", "銘柄", "種類", "点", "内容"].map((h) => (
                  <th key={h} className="py-1 pr-3 font-medium">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {alerts.length === 0 ? (
                <tr>
                  <td className="py-3 text-zinc-500" colSpan={5}>
                    分析後、買い・売り・反転・決済検討の条件を満たすとここに出ます。同一銘柄は12分間重複通知しません。
                  </td>
                </tr>
              ) : (
                alerts.slice(0, 30).map((alert) => (
                  <tr key={alert.id} className="border-t border-zinc-800">
                    <td className="py-2 text-zinc-500">{new Date(alert.time).toLocaleTimeString()}</td>
                    <td className="font-mono">{alert.display}</td>
                    <td>{alertTypeJa(alert.type)}</td>
                    <td className="font-mono">{alert.score}</td>
                    <td className="text-zinc-400">{alert.title} · {alert.reasons[0] ?? ""}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      {Object.keys(contracts).length ? (
        <p className="text-[11px] text-zinc-600">
          契約メタは OKX USDT-M linear SWAP。例: {contracts.BTCUSDT?.maxLeverage ?? "—"}x max (BTC)
        </p>
      ) : null}
    </div>
  );
}
