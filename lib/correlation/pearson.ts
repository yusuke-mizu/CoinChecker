function pearson(xs: number[], ys: number[]): number | null {
  const n = Math.min(xs.length, ys.length);
  if (n < 12) return null;
  let sumX = 0;
  let sumY = 0;
  let sumXX = 0;
  let sumYY = 0;
  let sumXY = 0;
  for (let i = 0; i < n; i += 1) {
    const x = xs[i];
    const y = ys[i];
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    sumX += x;
    sumY += y;
    sumXX += x * x;
    sumYY += y * y;
    sumXY += x * y;
  }
  const cov = n * sumXY - sumX * sumY;
  const denX = n * sumXX - sumX * sumX;
  const denY = n * sumYY - sumY * sumY;
  if (denX <= 0 || denY <= 0) return null;
  const r = cov / Math.sqrt(denX * denY);
  if (!Number.isFinite(r)) return null;
  return Math.max(-1, Math.min(1, r));
}

function toReturns(closes: number[]): number[] {
  const out: number[] = [];
  for (let i = 1; i < closes.length; i += 1) {
    const prev = closes[i - 1];
    const cur = closes[i];
    if (prev > 0 && Number.isFinite(prev) && Number.isFinite(cur)) {
      out.push((cur - prev) / prev);
    }
  }
  return out;
}

/** Pearson correlation of overlapping 1H percent returns vs BTC. */
export function btcReturnCorrelation(
  symbolCloses: number[],
  btcCloses: number[],
  lookback = 48,
): number | null {
  const n = Math.min(symbolCloses.length, btcCloses.length, lookback + 1);
  if (n < 20) return null;
  const a = toReturns(symbolCloses.slice(-n));
  const b = toReturns(btcCloses.slice(-n));
  const m = Math.min(a.length, b.length);
  return pearson(a.slice(-m), b.slice(-m));
}

export const HIGH_BTC_CORR = 0.75;
