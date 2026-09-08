import { NextResponse } from "next/server";
import { fetchVenueOhlcv, sourceForVenue } from "@/lib/market-data/venue-router";
import { toCompactUsdt } from "@/lib/market-data/provider";
import { emaSeries } from "@/lib/indicators";
import { apiError } from "@/lib/api/json-error";
import type { CoreTimeframe } from "@/lib/types/market";
import type { CandleVenue } from "@/lib/types/venue";

export const dynamic = "force-dynamic";

const TFS: CoreTimeframe[] = ["4h", "1h", "15m"];
const VENUES: CandleVenue[] = ["okx", "bybit", "binance"];

export async function GET(request: Request) {
  const url = new URL(request.url);
  const symbol = toCompactUsdt(url.searchParams.get("symbol") || "BTCUSDT");
  const tf = (url.searchParams.get("tf") || "4h") as CoreTimeframe;
  const venue = (url.searchParams.get("venue") || "okx") as CandleVenue;
  if (!TFS.includes(tf)) {
    return NextResponse.json(
      { success: false, error: "tf must be 4h, 1h, or 15m" },
      { status: 400 },
    );
  }
  if (!VENUES.includes(venue)) {
    return NextResponse.json(
      { success: false, error: "venue must be okx, bybit, or binance" },
      { status: 400 },
    );
  }
  try {
    const candles = await fetchVenueOhlcv(venue, symbol, tf, 250);
    const closes = candles.map((c) => c.close);
    return NextResponse.json({
      symbol,
      timeframe: tf,
      candles,
      ema20: emaSeries(closes, 20),
      ema50: emaSeries(closes, 50),
      ema200: emaSeries(closes, 200),
      source: sourceForVenue(venue, "ohlcv"),
      attribution:
        "Charts by TradingView Lightweight Charts (Apache-2.0). Data is not from TradingView.",
    });
  } catch (error) {
    return apiError(error, "OHLCV failed");
  }
}
