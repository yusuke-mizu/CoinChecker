export function mean(values: number[]): number | null {
  if (!values.length) return null;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

export function stdev(values: number[]): number | null {
  const m = mean(values);
  if (m == null || values.length < 2) return null;
  const v = values.reduce((acc, x) => acc + (x - m) ** 2, 0) / (values.length - 1);
  return Math.sqrt(v);
}

export function zScore(values: number[], current: number): number | null {
  const s = stdev(values);
  const m = mean(values);
  if (s == null || m == null || s === 0) return null;
  return (current - m) / s;
}

export function percentileRank(values: number[], current: number): number | null {
  if (!values.length) return null;
  const below = values.filter((v) => v <= current).length;
  return (below / values.length) * 100;
}

export function pctChange(current: number, past: number): number | null {
  if (!Number.isFinite(current) || !Number.isFinite(past) || past === 0) return null;
  return ((current - past) / Math.abs(past)) * 100;
}
