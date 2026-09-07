export function computePositionMetrics(input: {
  side: "LONG" | "SHORT";
  entry: number;
  current: number;
  leverage: number;
}) {
  const { side, entry, current, leverage } = input;
  if (!entry || !Number.isFinite(entry) || !Number.isFinite(current)) {
    return {
      priceChangePct: null as number | null,
      marginPnlPct: null as number | null,
      priceStopHit: false,
    };
  }
  const raw = ((current - entry) / entry) * 100;
  const priceChangePct = side === "LONG" ? raw : -raw;
  const marginPnlPct = priceChangePct * (Number.isFinite(leverage) && leverage > 0 ? leverage : 1);
  return {
    priceChangePct,
    marginPnlPct,
    priceStopHit: priceChangePct <= -10,
  };
}
