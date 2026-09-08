import type { Candle } from "@/lib/types/market";

/**
 * Aggregates base candles into a higher timeframe without extra requests.
 *
 * Only complete groups are emitted, and `indexFor` maps a base-bar index to the
 * last higher-timeframe bar that had already closed at that moment. Reading a
 * 1h feature at a 15m bar therefore never sees the in-progress hour, which is
 * what makes multi-timeframe features usable inside a historical loop.
 */
export type Resampled = {
  factor: number;
  candles: Candle[];
  /** For each base index, the index of the last closed aggregate bar, or -1. */
  indexFor: Int32Array;
};

export function resample(base: Candle[], factor: number): Resampled {
  const candles: Candle[] = [];
  const indexFor = new Int32Array(base.length).fill(-1);
  if (factor <= 1) {
    for (let i = 0; i < base.length; i += 1) indexFor[i] = i;
    return { factor: 1, candles: base, indexFor };
  }

  // Align groups to the timeframe boundary so bars match the exchange's own
  // higher-timeframe candles rather than an arbitrary offset.
  const stepMs = base.length > 1 ? base[1].openTime - base[0].openTime : 0;
  const groupMs = stepMs * factor;

  const closedAtBase: number[] = [];
  let cursor = 0;
  while (cursor < base.length) {
    const start = base[cursor];
    const boundary = groupMs > 0 ? Math.floor(start.openTime / groupMs) * groupMs : start.openTime;
    let end = cursor;
    let high = start.high;
    let low = start.low;
    let volume = 0;
    let takerBuyVolume: number | null = 0;
    while (end < base.length) {
      const candle = base[end];
      if (groupMs > 0 && candle.openTime >= boundary + groupMs) break;
      high = Math.max(high, candle.high);
      low = Math.min(low, candle.low);
      volume += candle.volume;
      if (candle.takerBuyVolume == null) takerBuyVolume = null;
      else if (takerBuyVolume != null) takerBuyVolume += candle.takerBuyVolume;
      end += 1;
    }
    const expected = groupMs > 0 ? factor : 1;
    const complete = end - cursor === expected;
    if (complete) {
      candles.push({
        openTime: start.openTime,
        open: start.open,
        high,
        low,
        close: base[end - 1].close,
        volume,
        closeTime: base[end - 1].closeTime,
        takerBuyVolume,
      });
      closedAtBase.push(end - 1);
    }
    cursor = end;
  }

  // An aggregate bar only becomes visible on the base bar that closed it.
  let aggregate = -1;
  let next = 0;
  for (let i = 0; i < base.length; i += 1) {
    while (next < closedAtBase.length && closedAtBase[next] <= i) {
      aggregate = next;
      next += 1;
    }
    indexFor[i] = aggregate;
  }
  return { factor, candles, indexFor };
}
