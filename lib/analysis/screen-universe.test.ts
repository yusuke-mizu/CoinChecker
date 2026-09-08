import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BtccCandidate, Candle, TickerSnapshot } from "@/lib/types/market";

const loadUniverse = vi.fn();
const fetchVenueOhlcv = vi.fn();

vi.mock("@/lib/analysis/universe", () => ({
  loadUniverse: (...args: unknown[]) => loadUniverse(...args),
}));
vi.mock("@/lib/market-data/venue-router", () => ({
  fetchVenueOhlcv: (...args: unknown[]) => fetchVenueOhlcv(...args),
}));

const { screenUniverse } = await import("./screen-universe");

function ticker(last: number, quote: number | null): TickerSnapshot {
  return {
    last,
    change24hPct: 2,
    high24h: last * 1.05,
    low24h: last * 0.95,
    volume24h: quote == null ? null : quote / last,
    quoteVolume24h: quote,
  };
}

function candidate(
  symbol: string,
  quoteVolume: number | null,
  venue: "okx" | null = "okx",
): BtccCandidate {
  return {
    symbol,
    display: symbol,
    marketVenue: venue,
    ticker: ticker(100, quoteVolume),
  } as unknown as BtccCandidate;
}

function candles(count: number, now: number): Candle[] {
  return Array.from({ length: count }, (_, index) => {
    const openTime = now - (count - 1 - index) * 15 * 60_000;
    return {
      openTime,
      open: 100,
      high: 101,
      low: 99,
      close: 100 + Math.sin(index) * 0.5,
      volume: 1_000,
      closeTime: openTime + 15 * 60_000 - 1,
    };
  });
}

describe("screenUniverse", () => {
  beforeEach(() => {
    loadUniverse.mockReset();
    fetchVenueOhlcv.mockReset();
    fetchVenueOhlcv.mockResolvedValue(candles(96, Date.now()));
  });

  it("keeps every discovered symbol under watch and only probes the shortlist", async () => {
    const rows = Array.from({ length: 60 }, (_, index) =>
      candidate(`SYM${index}USDT`, 1_000_000 * (index + 1)),
    );
    loadUniverse.mockResolvedValue({ candidates: rows });

    const result = await screenUniverse({
      prescreenSize: 40,
      candleProbeSize: 5,
      detailSize: 3,
      force: true,
    });

    expect(result.discovered).toBe(60);
    expect(result.marketDataAvailable).toBe(60);
    expect(result.prescreened).toBe(40);
    // One candle request per probe target, never one per discovered symbol.
    expect(result.candleRequests).toBe(5);
    expect(fetchVenueOhlcv).toHaveBeenCalledTimes(5);
    expect(result.detailCandidates).toHaveLength(3);
  });

  it("spends no candle requests when probing is disabled", async () => {
    loadUniverse.mockResolvedValue({
      candidates: [candidate("BTCUSDT", 5_000_000), candidate("ETHUSDT", 2_000_000)],
    });

    const result = await screenUniverse({ candleProbeSize: 0, force: true });

    expect(fetchVenueOhlcv).not.toHaveBeenCalled();
    expect(result.rows.every((row) => row.stage === "TICKER_ONLY")).toBe(true);
  });

  it("lowers confidence instead of dropping symbols with missing turnover", async () => {
    loadUniverse.mockResolvedValue({
      candidates: [candidate("BTCUSDT", 5_000_000), candidate("AAAUSDT", null)],
    });

    const result = await screenUniverse({ candleProbeSize: 0, force: true });
    const degraded = result.rows.find((row) => row.symbol === "AAAUSDT");

    expect(degraded).toBeDefined();
    expect(degraded?.excluded).toBe(false);
    expect(degraded?.confidencePenalty).toBeGreaterThan(0);
  });

  it("survives candle failures for individual symbols", async () => {
    loadUniverse.mockResolvedValue({
      candidates: [candidate("BTCUSDT", 5_000_000), candidate("ETHUSDT", 4_000_000)],
    });
    fetchVenueOhlcv.mockRejectedValueOnce(new Error("timeout"));

    const result = await screenUniverse({ candleProbeSize: 2, force: true });

    expect(result.rows).toHaveLength(2);
    expect(result.rows.some((row) => row.notes.some((note) => note.includes("失敗")))).toBe(true);
  });

  it("does not rank an abnormal 24h spike above a liquid, mid-range symbol", async () => {
    const spike = candidate("PUMPUSDT", 3_000_000);
    spike.ticker = { ...(spike.ticker as TickerSnapshot), change24hPct: 60 };
    loadUniverse.mockResolvedValue({
      candidates: [candidate("BTCUSDT", 3_000_000), spike],
    });

    const result = await screenUniverse({ candleProbeSize: 0, force: true });
    const calm = result.rows.find((row) => row.symbol === "BTCUSDT");
    const pumped = result.rows.find((row) => row.symbol === "PUMPUSDT");

    expect(pumped?.abnormalMove).toBe(true);
    expect(calm?.screenScore ?? 0).toBeGreaterThan(pumped?.screenScore ?? 100);
  });
});
