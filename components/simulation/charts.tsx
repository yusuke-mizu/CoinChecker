"use client";

import type { Bucket } from "@/lib/types/simulation";

const WIDTH = 720;

function pathFor(values: number[], height: number, logScale: boolean): string {
  if (values.length < 2) return "";
  const mapped = logScale ? values.map((value) => Math.log10(Math.max(value, 1e-6))) : values;
  const min = Math.min(...mapped);
  const max = Math.max(...mapped);
  const span = max - min || 1;
  return mapped
    .map((value, index) => {
      const x = (index / (mapped.length - 1)) * WIDTH;
      const y = height - ((value - min) / span) * height;
      return `${index === 0 ? "M" : "L"}${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(" ");
}

export function LineChart({
  values,
  label,
  color = "#34d399",
  height = 140,
  logScale = false,
  baseline,
}: {
  values: number[];
  label: string;
  color?: string;
  height?: number;
  logScale?: boolean;
  baseline?: number;
}) {
  if (values.length < 2) {
    return (
      <div className="rounded border border-zinc-800 bg-zinc-950/60 p-3 text-xs text-zinc-500">
        {label}: データ点が不足しています。
      </div>
    );
  }
  const line = pathFor(values, height, logScale);
  const mapped = logScale ? values.map((v) => Math.log10(Math.max(v, 1e-6))) : values;
  const min = Math.min(...mapped);
  const max = Math.max(...mapped);
  const span = max - min || 1;
  const baselineY =
    baseline == null
      ? null
      : height -
        (((logScale ? Math.log10(Math.max(baseline, 1e-6)) : baseline) - min) / span) * height;

  return (
    <figure className="rounded border border-zinc-800 bg-zinc-950/60 p-3">
      <figcaption className="mb-2 flex items-baseline justify-between text-[11px] text-zinc-500">
        <span>{label}</span>
        <span className="font-mono">
          {values[0].toLocaleString("ja-JP", { maximumFractionDigits: 0 })} →{" "}
          {values[values.length - 1].toLocaleString("ja-JP", { maximumFractionDigits: 0 })}
        </span>
      </figcaption>
      <svg
        viewBox={`0 0 ${WIDTH} ${height}`}
        preserveAspectRatio="none"
        className="h-32 w-full"
        role="img"
        aria-label={label}
      >
        {baselineY != null && baselineY >= 0 && baselineY <= height ? (
          <line
            x1={0}
            x2={WIDTH}
            y1={baselineY}
            y2={baselineY}
            stroke="#52525b"
            strokeDasharray="4 4"
            strokeWidth={1}
          />
        ) : null}
        <path d={line} fill="none" stroke={color} strokeWidth={1.6} />
      </svg>
    </figure>
  );
}

export function DrawdownChart({ values, height = 100 }: { values: number[]; height?: number }) {
  if (values.length < 2) return null;
  const max = Math.max(...values, 1);
  const points = values
    .map((value, index) => {
      const x = (index / (values.length - 1)) * WIDTH;
      const y = (value / max) * height;
      return `${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(" ");
  return (
    <figure className="rounded border border-zinc-800 bg-zinc-950/60 p-3">
      <figcaption className="mb-2 flex items-baseline justify-between text-[11px] text-zinc-500">
        <span>Drawdown Curve</span>
        <span className="font-mono text-rose-300">最大 -{max.toFixed(2)}%</span>
      </figcaption>
      <svg
        viewBox={`0 0 ${WIDTH} ${height}`}
        preserveAspectRatio="none"
        className="h-24 w-full"
        role="img"
        aria-label="Drawdown Curve"
      >
        <polygon points={`0,0 ${points} ${WIDTH},0`} fill="#f43f5e33" stroke="none" />
        <polyline points={points} fill="none" stroke="#fb7185" strokeWidth={1.4} />
      </svg>
    </figure>
  );
}

export function HistogramBars({ buckets, label }: { buckets: Bucket[]; label: string }) {
  const max = Math.max(1, ...buckets.map((bucket) => bucket.count));
  const total = buckets.reduce((sum, bucket) => sum + bucket.count, 0);
  return (
    <figure className="rounded border border-zinc-800 bg-zinc-950/60 p-3">
      <figcaption className="mb-2 text-[11px] text-zinc-500">
        {label} <span className="font-mono">n={total}</span>
      </figcaption>
      <div className="space-y-1">
        {buckets.map((bucket) => (
          <div key={bucket.label} className="flex items-center gap-2 text-[11px]">
            <span className="w-24 shrink-0 text-right font-mono text-zinc-500">
              {bucket.label}
            </span>
            <span className="h-3 flex-1 overflow-hidden rounded bg-zinc-900">
              <span
                className="block h-full rounded bg-cyan-500/60"
                style={{ width: `${(bucket.count / max) * 100}%` }}
              />
            </span>
            <span className="w-12 shrink-0 font-mono text-zinc-400">{bucket.count}</span>
          </div>
        ))}
      </div>
    </figure>
  );
}
