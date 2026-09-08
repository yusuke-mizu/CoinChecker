"use client";

import { useMemo, useState } from "react";
import type { CoreTimeframe } from "@/lib/types/market";
import type { SymbolAnalysis } from "@/lib/types/scoring";
import { adviceFor, flagJa, futuresJa, macdJa, reversalJa, trendJa } from "@/lib/copy/ja";
import { CandleChart } from "@/components/CandleChart";
import { formatNum, formatPct, formatPrice, signalClass } from "@/components/format";
import type { ExpectedEntryAssessment } from "@/lib/scoring/expected-entry";

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
              {formatPrice(row.ticker?.last)} · {formatPct(row.ticker?.change24hPct)} · BTC連動{" "}
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
          <div className={`rounded-lg border p-3 ${signalClass(row.signal)}`}>
            <div className="text-lg font-semibold">{adviceFor(row).tag}</div>
            <p className="mt-1 text-sm leading-5">{adviceFor(row).action}</p>
            <p className="mt-1 text-xs opacity-80">{adviceFor(row).why}</p>
            <p className="mt-2 text-[11px] opacity-70">
              Score represents signal strength, not probability of future price movement.
            </p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <ExpectancyPanel assessment={row.entryExpectancy.long} />
            <ExpectancyPanel assessment={row.entryExpectancy.short} />
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
            <Mini label="買い ENTRY" value={row.entryExpectancy.long?.total} />
            <Mini label="売り ENTRY" value={row.entryExpectancy.short?.total} />
            <Mini label="TIMING" value={row.timing?.score} />
            <Mini label="信頼度" value={row.confidence} />
            <Mini label="DATA QUALITY" value={row.dataQuality.score} />
          </div>
          <section className="rounded-lg border border-zinc-800 bg-zinc-900/70 p-3 text-xs">
            <div className="font-medium text-zinc-200">
              {row.availability} · BTCC Listing {row.listingVerification} · Contract{" "}
              {row.contractClassification}
            </div>
            <div className="mt-2 grid gap-1 text-zinc-400 sm:grid-cols-2">
              <div>Listing: {row.sources.listing.map((source) => source.label).join(" / ") || "N/A"}</div>
              <div>OHLCV: {row.sources.ohlcv?.label ?? "N/A"}</div>
              <div>OI: {row.sources.oi?.label ?? "N/A"}</div>
              <div>Funding: {row.sources.funding?.label ?? "N/A"}</div>
            </div>
            {row.dataQuality.reasons.length ? (
              <p className="mt-2 text-amber-200">{row.dataQuality.reasons.join(" / ")}</p>
            ) : null}
          </section>
          <p className="text-xs text-zinc-400">
            {row.regime?.regime ?? "—"} · Trend {row.regime?.trendScore ?? "—"} · Range {row.regime?.rangeScore ?? "—"} ·
            Drift {row.regime?.driftScore ?? "—"} {row.regime?.driftSide ?? ""}
          </p>
          {row.nextWindow ? (
            <p className="text-xs text-zinc-400">
              NEXT WINDOW {row.nextWindow.label}（{row.nextWindow.confidence}）· {row.nextWindow.reasons[0]}
            </p>
          ) : null}
          {row.timing?.waitReasons.length ? (
            <ul className="list-disc pl-4 text-xs text-amber-200">
              {row.timing.waitReasons.map((r) => (
                <li key={r}>{r}</li>
              ))}
            </ul>
          ) : null}
          {row.timing?.items.length ? (
            <div className="text-[11px] text-zinc-500">
              {row.timing.items.map((item) => (
                <div key={item.key}>
                  {item.key} {item.points}/{item.max} · {item.reason}
                </div>
              ))}
            </div>
          ) : null}
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm text-zinc-400">
              買い期待値 {row.entryExpectancy.long?.total ?? "—"} / 売り期待値 {row.entryExpectancy.short?.total ?? "—"} · 差 {row.difference ?? "—"}
              · {reversalJa(row.reversal?.signal)}
            </span>
          </div>
          {row.contract ? (
            <p className="text-xs text-zinc-500">
              補完先 {row.marketVenue?.toUpperCase()} contract: {row.contract.contractType} · margin{" "}
              {row.contract.marginAsset} · {row.contract.settlement}
              {row.contract.maxLeverage != null ? ` · max ${row.contract.maxLeverage}x` : ""}
            </p>
          ) : null}

          <div className="grid gap-3 sm:grid-cols-2">
            <ScorePanel title="買い Trend Context" score={row.long} accent="emerald" />
            <ScorePanel title="売り Trend Context" score={row.short} accent="rose" />
          </div>

          {row.long ? (
            <section>
              <h3 className="text-sm font-semibold text-zinc-200">旧方向性Context内訳（買い）</h3>
              <Breakdown items={row.long.items} total={row.long.total} />
            </section>
          ) : null}
          {row.short ? (
            <section>
              <h3 className="text-sm font-semibold text-zinc-200">旧方向性Context内訳（売り）</h3>
              <Breakdown items={row.short.items} total={row.short.total} />
              {row.short.renormalized ? (
                <p className="mt-1 text-[11px] text-zinc-500">OI/Funding欠落のためエントリー内訳を再正規化しています。</p>
              ) : null}
            </section>
          ) : null}

          {row.futures ? (
            <section className="rounded-lg border border-zinc-800 bg-zinc-900/70 p-3 text-xs">
              <h3 className="text-sm font-semibold text-zinc-200">先物の建玉</h3>
              <p className="mt-1 text-lg font-semibold text-zinc-100">{futuresJa(row.futures.structure)}</p>
              <p className="mt-1 text-zinc-400">{row.futures.narrativeJa}</p>
              {(row.futures.flags?.length ?? 0) > 0 ? (
                <p className="mt-1 text-amber-200">{row.futures.flags.map(flagJa).join(" · ")}</p>
              ) : null}
              <div className="mt-2 grid grid-cols-2 gap-2 font-mono">
                <div>Price 1H {formatPct(row.futures.priceChange1hPct)}</div>
                <div>OI 15m {formatPct(row.futures.oiChange15mPct)}</div>
                <div>OI 1H {formatPct(row.futures.oiChange1hPct)}</div>
                <div>OI 4H {formatPct(row.futures.oiChange4hPct)}</div>
                <div>
                  Funding{" "}
                  {row.futures.fundingRate == null ? "unavailable" : `${(row.futures.fundingRate * 100).toFixed(4)}%`}
                </div>
                <div>Fund %ile {formatNum(row.futures.fundingPercentile, 0)}</div>
                <div>OI %ile {formatNum(row.futures.oiPercentile, 0)}</div>
                <div>OI band {row.futures.oiBand}</div>
                <div>Score {row.futures.score}/100</div>
                <div>
                  {row.futures.availableOi ? "OI ok" : "OI unavailable"} ·{" "}
                  {row.futures.availableFunding ? "Funding ok" : "Funding unavailable"}
                </div>
              </div>
              <p className="mt-2 text-zinc-500">
                OI mom {row.futures.oiMomentum}/25 · Fund {row.futures.fundingBias}/25 · Price/OI {row.futures.priceOi}/25 ·
                Liq {row.futures.liquidation}/25
              </p>
            </section>
          ) : null}

          {row.marketVenue ? (
            <CandleChart
              symbol={row.symbol}
              venue={row.marketVenue}
              timeframe={tf}
              onTimeframe={setTf}
            />
          ) : null}

          <table className="min-w-full text-left text-xs">
            <thead className="text-zinc-500">
              <tr>
                {["足", "トレンド", "RSI", "MACD", "ADX", "出来高", "形"].map((h) => (
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
                    <td className="py-1 pr-3">{trendJa(tfRow.trend)}</td>
                    <td className="py-1 pr-3 font-mono">{formatNum(tfRow.rsi, 1)}</td>
                    <td className="py-1 pr-3">{macdJa(tfRow.macdBias)}</td>
                    <td className="py-1 pr-3 font-mono">{formatNum(tfRow.adx, 1)}</td>
                    <td className="py-1 pr-3 font-mono">{formatNum(tfRow.volumeRatio, 2)}</td>
                    <td className="py-1 pr-3 font-mono">{tfRow.structure}</td>
                  </tr>
                ) : (
                  <tr key={idx} className="border-t border-zinc-800">
                    <td className="py-1 text-zinc-500" colSpan={7}>
                      この足はデータなし
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

function ExpectancyPanel({ assessment }: { assessment: ExpectedEntryAssessment | null }) {
  if (!assessment) {
    return <div className="rounded-lg border border-zinc-800 p-3 text-xs text-zinc-500">Expected Entry: N/A</div>;
  }
  return (
    <section className="rounded-lg border border-zinc-800 bg-zinc-900/80 p-3 text-xs">
      <div className="flex items-center justify-between">
        <b className={assessment.direction === "LONG" ? "text-emerald-300" : "text-rose-300"}>
          {assessment.direction} ENTRY SCORE {assessment.total}
        </b>
        <span className="text-zinc-400">{assessment.decision.replaceAll("_", " ")}</span>
      </div>
      <div className="mt-2 grid grid-cols-2 gap-1 font-mono text-zinc-300">
        <span>Trend {assessment.trendQuality}</span>
        <span>Timing {assessment.timingScore}</span>
        <span>Expected Move {assessment.expectedMoveScore}</span>
        <span>Reversal Risk {assessment.reversalRisk}</span>
        <span>Reward +{assessment.potentialRewardPct.toFixed(2)}%</span>
        <span>Risk -{assessment.potentialRiskPct.toFixed(2)}%</span>
        <span>R/R {assessment.rewardRisk.toFixed(2)}</span>
        <span>Chasing {assessment.chasingPenalty}</span>
        <span>Target {formatPrice(assessment.targetPrice)}</span>
        <span>Structural Stop {formatPrice(assessment.structuralStopPrice)}</span>
      </div>
      <p className="mt-2 text-zinc-400">
        ENTRY TYPE {assessment.entryType} · THEORETICAL EXPECTED MOVE（過去実績ではありません）
      </p>
      {assessment.lateEntryWarning ? (
        <p className="mt-1 font-semibold text-amber-300">STRONG TREND / LATE ENTRY</p>
      ) : null}
      <div className="mt-2 border-t border-zinc-800 pt-2">
        {assessment.items.map((item) => (
          <p key={item.key} className="text-zinc-400">
            {item.label}: +{item.points.toFixed(1)}/{item.weight} · {item.reason}
          </p>
        ))}
        <p className="text-amber-300">Chasing Penalty: -{assessment.chasingPenaltyPoints}</p>
      </div>
      <div className="mt-2">
        <b className="text-zinc-200">WHY ENTRY?</b>
        {assessment.why.map((reason) => <p key={reason} className="text-zinc-400">✓ {reason}</p>)}
        {assessment.warnings.map((warning) => <p key={warning} className="text-amber-300">⚠ {warning}</p>)}
      </div>
    </section>
  );
}

function Mini({ label, value }: { label: string; value: string | number | null | undefined }) {
  return (
    <div className="rounded-md border border-zinc-800 px-2 py-2">
      <div className="text-[10px] text-zinc-500">{label}</div>
      <div className="font-mono text-lg text-zinc-100">{value ?? "—"}</div>
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
        <span className="font-semibold text-zinc-200">合計</span>
        <span className="font-mono font-semibold">{total} / 100</span>
        <span />
      </div>
    </div>
  );
}
