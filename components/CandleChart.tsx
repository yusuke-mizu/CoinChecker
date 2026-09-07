"use client";

import { useEffect, useRef } from "react";
import {
  CandlestickSeries,
  ColorType,
  HistogramSeries,
  LineSeries,
  createChart,
  type IChartApi,
  type UTCTimestamp,
} from "lightweight-charts";
import type { CoreTimeframe } from "@/lib/types/market";
import type { OhlcvPayload } from "@/components/format";

const TFS: CoreTimeframe[] = ["4h", "1h", "15m"];

export function CandleChart({
  symbol,
  timeframe,
  onTimeframe,
}: {
  symbol: string;
  timeframe: CoreTimeframe;
  onTimeframe: (tf: CoreTimeframe) => void;
}) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const chart = createChart(host, {
      layout: {
        background: { type: ColorType.Solid, color: "#09090b" },
        textColor: "#a1a1aa",
        attributionLogo: true,
      },
      grid: {
        vertLines: { color: "#18181b" },
        horzLines: { color: "#18181b" },
      },
      rightPriceScale: { borderColor: "#27272a" },
      timeScale: { borderColor: "#27272a" },
      autoSize: true,
    });
    chartRef.current = chart;

    const candles = chart.addSeries(CandlestickSeries, {
      upColor: "#34d399",
      downColor: "#fb7185",
      borderVisible: false,
      wickUpColor: "#34d399",
      wickDownColor: "#fb7185",
    });
    const ema20 = chart.addSeries(LineSeries, { color: "#38bdf8", lineWidth: 1, title: "EMA20" });
    const ema50 = chart.addSeries(LineSeries, { color: "#f59e0b", lineWidth: 1, title: "EMA50" });
    const ema200 = chart.addSeries(LineSeries, { color: "#c084fc", lineWidth: 1, title: "EMA200" });
    const volume = chart.addSeries(HistogramSeries, {
      priceFormat: { type: "volume" },
      priceScaleId: "volume",
    });
    chart.priceScale("volume").applyOptions({
      scaleMargins: { top: 0.8, bottom: 0 },
    });

    let cancelled = false;
    async function load() {
      const response = await fetch(
        `/api/ohlcv?symbol=${encodeURIComponent(symbol)}&tf=${encodeURIComponent(timeframe)}`,
      );
      const json = (await response.json()) as OhlcvPayload & { error?: string };
      if (!response.ok || cancelled) return;
      candles.setData(
        json.candles.map((c) => ({
          time: Math.floor(c.openTime / 1000) as UTCTimestamp,
          open: c.open,
          high: c.high,
          low: c.low,
          close: c.close,
        })),
      );
      const line = (series: Array<number | null>) =>
        json.candles.flatMap((c, i) => {
          const value = series[i];
          return value == null
            ? []
            : [{ time: Math.floor(c.openTime / 1000) as UTCTimestamp, value }];
        });
      ema20.setData(line(json.ema20));
      ema50.setData(line(json.ema50));
      ema200.setData(line(json.ema200));
      volume.setData(
        json.candles.map((c) => ({
          time: Math.floor(c.openTime / 1000) as UTCTimestamp,
          value: c.volume,
          color: c.close >= c.open ? "rgba(52, 211, 153, 0.35)" : "rgba(251, 113, 133, 0.35)",
        })),
      );
      chart.timeScale().fitContent();
    }

    void load();
    return () => {
      cancelled = true;
      chart.remove();
      chartRef.current = null;
    };
  }, [symbol, timeframe]);

  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div className="flex gap-1">
          {TFS.map((tf) => (
            <button
              key={tf}
              type="button"
              onClick={() => onTimeframe(tf)}
              className={`rounded-md px-2 py-1 text-xs font-medium ${
                timeframe === tf
                  ? "bg-zinc-100 text-zinc-950"
                  : "border border-zinc-700 text-zinc-400 hover:border-zinc-500"
              }`}
            >
              {tf.toUpperCase()}
            </button>
          ))}
        </div>
        <p className="text-[10px] text-zinc-500">
          Charts by TradingView Lightweight Charts · data is our OKX OHLCV, not TradingView
        </p>
      </div>
      <div ref={hostRef} className="h-80 w-full rounded-md border border-zinc-800" />
    </div>
  );
}
