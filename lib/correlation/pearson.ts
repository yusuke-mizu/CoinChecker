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

/** OLS beta of overlapping 1H returns against BTC; null when variance is insufficient. */
export function btcReturnBeta(
  symbolCloses: number[],
  btcCloses: number[],
  lookback = 48,
): number | null {
  const n = Math.min(symbolCloses.length, btcCloses.length, lookback + 1);
  if (n < 20) return null;
  const symbolReturns = toReturns(symbolCloses.slice(-n));
  const btcReturns = toReturns(btcCloses.slice(-n));
  const count = Math.min(symbolReturns.length, btcReturns.length);
  const xs = symbolReturns.slice(-count);
  const ys = btcReturns.slice(-count);
  const meanX = xs.reduce((sum, value) => sum + value, 0) / count;
  const meanY = ys.reduce((sum, value) => sum + value, 0) / count;
  const covariance = xs.reduce(
    (sum, value, index) => sum + (value - meanX) * (ys[index] - meanY),
    0,
  );
  const btcVariance = ys.reduce((sum, value) => sum + (value - meanY) ** 2, 0);
  if (btcVariance <= 0) return null;
  const beta = covariance / btcVariance;
  return Number.isFinite(beta) ? Math.max(-5, Math.min(5, beta)) : null;
}

export const HIGH_BTC_CORR = 0.75;
