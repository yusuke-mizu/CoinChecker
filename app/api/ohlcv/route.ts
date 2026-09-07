import { NextResponse } from "next/server";
import { fetchOkxOhlcv } from "@/lib/market-data/okx";
import { toCompactUsdt } from "@/lib/market-data/provider";
import { emaSeries } from "@/lib/indicators";
import type { CoreTimeframe } from "@/lib/types/market";

export const dynamic = "force-dynamic";

const TFS: CoreTimeframe[] = ["4h", "1h", "15m"];

export async function GET(request: Request) {
  const url = new URL(request.url);
  const symbol = toCompactUsdt(url.searchParams.get("symbol") || "BTCUSDT");
  const tf = (url.searchParams.get("tf") || "4h") as CoreTimeframe;
  if (!TFS.includes(tf)) {
    return NextResponse.json({ error: "tf must be 4h, 1h, or 15m" }, { status: 400 });
  }
  try {
    const candles = await fetchOkxOhlcv(symbol, tf, 250);
    const closes = candles.map((c) => c.close);
    return NextResponse.json({
      symbol,
      timeframe: tf,
      candles,
      ema20: emaSeries(closes, 20),
      ema50: emaSeries(closes, 50),
      ema200: emaSeries(closes, 200),
      source: "okx-public-swap-candles",
      attribution: "Charts by TradingView Lightweight Charts (Apache-2.0). Data is not from TradingView.",
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "OHLCV failed" },
      { status: 500 },
    );
  }
}
