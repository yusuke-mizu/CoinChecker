"use client";

import { DrawdownChart, HistogramBars, LineChart } from "./charts";
import { STRATEGY_BY_ID } from "@/lib/simulation/strategies";
import { formatNum, formatPct } from "@/components/format";
import type { BacktestResult, RegimeBreakdown, ScoreCard } from "@/lib/types/simulation";

function yen(value: number): string {
  return `¥${Math.round(value).toLocaleString("ja-JP")}`;
}

function ratio(value: number): string {
  if (!Number.isFinite(value)) return "∞";
  return value.toFixed(2);
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="rounded border border-zinc-800 bg-zinc-950/70 p-2">
      <p className="text-[10px] tracking-[0.12em] text-zinc-500">{label}</p>
      <p className={`mt-1 font-mono text-sm ${tone ?? "text-zinc-100"}`}>{value}</p>
    </div>
  );
}

export function ScoreCardGrid({ card }: { card: ScoreCard }) {
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-6">
      <Stat label="TRADE COUNT" value={String(card.tradeCount)} />
      <Stat label="WIN RATE" value={`${card.winRate.toFixed(1)}%`} />
      <Stat
        label="EXPECTED VALUE"
        value={formatPct(card.expectedValuePct)}
        tone={card.expectedValuePct > 0 ? "text-emerald-300" : "text-rose-300"}
      />
      <Stat
        label="EXPECTANCY (R)"
        value={formatNum(card.expectancyR)}
        tone={card.expectancyR > 0 ? "text-emerald-300" : "text-rose-300"}
      />
      <Stat
        label="PROFIT FACTOR"
        value={ratio(card.profitFactor)}
        tone={card.profitFactor > 1 ? "text-emerald-300" : "text-rose-300"}
      />
      <Stat label="AVG WIN / LOSS" value={`${formatPct(card.averageWinPct)} / ${formatPct(card.averageLossPct)}`} />
      <Stat label="MAX CONSEC. LOSS" value={String(card.maxConsecutiveLosses)} />
      <Stat label="SHARPE (per trade)" value={formatNum(card.sharpe)} />
      <Stat label="SORTINO (per trade)" value={formatNum(card.sortino)} />
      <Stat label="AVG HOLDING" value={`${Math.round(card.averageHoldingMinutes)}m`} />
      <Stat
        label="LIQUIDATIONS"
        value={String(card.liquidationCount)}
        tone={card.liquidationCount > 0 ? "text-rose-300" : "text-zinc-100"}
      />
      <Stat label="BEST / WORST" value={`${formatPct(card.bestTradePct)} / ${formatPct(card.worstTradePct)}`} />
    </div>
  );
}

function BreakdownTable({ title, rows }: { title: string; rows: RegimeBreakdown[] }) {
  if (rows.length === 0) return null;
  return (
    <div className="rounded border border-zinc-800 bg-zinc-950/60 p-3">
      <p className="text-[11px] tracking-[0.14em] text-zinc-500">{title}</p>
      <table className="mt-2 w-full text-[11px]">
        <thead className="text-zinc-500">
          <tr>
            <th className="text-left font-normal">KEY</th>
            <th className="text-right font-normal">N</th>
            <th className="text-right font-normal">WIN</th>
            <th className="text-right font-normal">EV</th>
            <th className="text-right font-normal">R</th>
            <th className="text-right font-normal">PF</th>
          </tr>
        </thead>
        <tbody className="font-mono">
          {rows.map((row) => (
            <tr key={row.key} className="border-t border-zinc-900">
              <td className="py-1 text-left text-zinc-300">{row.key}</td>
              <td className="text-right text-zinc-400">{row.tradeCount}</td>
              <td className="text-right text-zinc-400">{row.winRate.toFixed(1)}%</td>
              <td
                className={`text-right ${row.expectedValuePct > 0 ? "text-emerald-300" : "text-rose-300"}`}
              >
                {formatPct(row.expectedValuePct)}
              </td>
              <td className="text-right text-zinc-400">{formatNum(row.expectancyR)}</td>
              <td className="text-right text-zinc-400">{ratio(row.profitFactor)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function SimulationResults({ result }: { result: BacktestResult }) {
  const { portfolio, scorecard } = result;
  const span =
    result.dataStart && result.dataEnd
      ? `${new Date(result.dataStart).toLocaleDateString()} 〜 ${new Date(result.dataEnd).toLocaleDateString()}`
      : "—";

  return (
    <div className="space-y-4">
      <section className="rounded-lg border border-zinc-800 bg-zinc-900/60 p-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-sm font-semibold tracking-[0.14em] text-zinc-300">
            BACKTEST RESULT
          </h2>
          <p className="text-[11px] text-zinc-500">
            {span} · {result.candlesLoaded.toLocaleString()} candles · {result.requests} requests ·
            {" "}{portfolio.spanDays.toFixed(1)} days
          </p>
        </div>

        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-6">
          <Stat label="INITIAL CAPITAL" value={yen(portfolio.initialCapital)} />
          <Stat
            label="FINAL CAPITAL"
            value={yen(portfolio.finalCapital)}
            tone={portfolio.finalCapital >= portfolio.initialCapital ? "text-emerald-300" : "text-rose-300"}
          />
          <Stat
            label="TOTAL RETURN"
            value={formatPct(portfolio.totalReturnPct)}
            tone={portfolio.totalReturnPct > 0 ? "text-emerald-300" : "text-rose-300"}
          />
          <Stat
            label="CAGR"
            value={portfolio.cagrPct == null ? "—" : formatPct(portfolio.cagrPct)}
            tone="text-zinc-300"
          />
          <Stat label="MAX DRAWDOWN" value={`-${portfolio.maxDrawdownPct.toFixed(2)}%`} tone="text-rose-300" />
          <Stat label="EXECUTED / TOTAL" value={`${portfolio.executedTrades} / ${result.totalTrades}`} />
          <Stat label="SKIPPED (POS LIMIT)" value={String(portfolio.skippedByPositionLimit)} />
          <Stat label="SIZE CAPPED" value={String(portfolio.sizeCappedTrades)} />
          <Stat label="FEES" value={yen(portfolio.feesPaid)} />
          <Stat label="FUNDING COST" value={yen(portfolio.fundingPaid)} />
          <Stat
            label="LIQUIDATION COUNT"
            value={String(portfolio.liquidations)}
            tone={portfolio.liquidations > 0 ? "text-rose-300" : "text-zinc-100"}
          />
          <Stat label="PEAK GROSS EXPOSURE" value={yen(portfolio.peakGrossExposure)} />
        </div>

        <p className="mt-3 text-[11px] leading-5 text-zinc-500">
          Entryは各シグナル足の<b>次足始値</b>で約定させ、SL/TP判定は1本ずつ前進しながら、同一足内で
          StopとTargetの両方が射程に入る場合はStop優先（悲観側）で処理しています。バックテスト結果は
          将来の成績を保証しません。
        </p>
      </section>

      <section className="grid gap-3 lg:grid-cols-2">
        <LineChart
          values={portfolio.curve.map((point) => point.capital)}
          label="Capital Curve (JPY)"
          baseline={portfolio.initialCapital}
        />
        <DrawdownChart values={portfolio.curve.map((point) => point.drawdownPct)} />
      </section>

      <section className="rounded-lg border border-zinc-800 bg-zinc-900/60 p-4">
        <h3 className="text-xs tracking-[0.14em] text-zinc-500">ALL TRADES SCORECARD</h3>
        <div className="mt-3">
          <ScoreCardGrid card={scorecard} />
        </div>
      </section>

      <section className="grid gap-3 lg:grid-cols-2">
        <HistogramBars buckets={result.returnHistogram} label="Profit / Loss Distribution" />
        <HistogramBars buckets={result.holdingHistogram} label="Holding Time Distribution" />
      </section>

      <section className="grid gap-3 lg:grid-cols-3">
        <BreakdownTable title="BY MARKET REGIME" rows={result.byRegime} />
        <BreakdownTable title="BY VOLATILITY" rows={result.byVolatility} />
        <BreakdownTable title="BY SYMBOL" rows={result.bySymbol} />
        <BreakdownTable title="BY TIMEFRAME" rows={result.byTimeframe} />
        <BreakdownTable title="BY HOLDING BARS" rows={result.byHoldingBucket} />
      </section>

      {result.byStrategy.length ? (
        <section className="space-y-3">
          <h3 className="text-xs tracking-[0.14em] text-zinc-500">STRATEGY SCORECARD</h3>
          {result.byStrategy.map((report) => (
            <article key={report.strategy} className="rounded-lg border border-zinc-800 bg-zinc-900/60 p-4">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <b className="text-sm">{STRATEGY_BY_ID.get(report.strategy)?.label ?? report.strategy}</b>
                <span className="text-[11px] text-zinc-500">
                  {STRATEGY_BY_ID.get(report.strategy)?.description}
                </span>
              </div>
              <div className="mt-3">
                <ScoreCardGrid card={report.scorecard} />
              </div>
              <div className="mt-3">
                <BreakdownTable title="REGIME BREAKDOWN" rows={report.regimes} />
              </div>
            </article>
          ))}
        </section>
      ) : null}

      {result.warnings.length ? (
        <section className="rounded-lg border border-amber-700/50 bg-amber-950/20 p-4 text-[11px] text-amber-200">
          <p className="tracking-[0.14em]">NOTES</p>
          <ul className="mt-2 space-y-1">
            {result.warnings.slice(0, 20).map((warning, index) => (
              <li key={`${warning.scope}-${index}`}>
                <b className="font-mono">{warning.scope}</b>: {warning.message}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
