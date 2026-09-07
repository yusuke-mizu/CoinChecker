import { NextResponse } from "next/server";
import { analyzeSymbol } from "@/lib/analysis/analyze-symbol";
import { DATA_SOURCE_NOTES, DISCLAIMER } from "@/lib/analysis/notes";
import { loadMarketEnv } from "@/lib/analysis/market-env";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as {
      symbol?: string;
    };
    const symbol = (body.symbol || "BTCUSDT").toUpperCase();
    const env = await loadMarketEnv();
    const focus = await analyzeSymbol(symbol, {
      btc4h: env.btc4h,
      btc1hCloses: env.btc1hCloses,
      dominancePct: env.dominancePct,
    });

    return NextResponse.json({
      phase: "full",
      disclaimer: DISCLAIMER,
      dataSources: {
        symbols: "coingecko-btcc-tickers ∩ okx-usdt-swap",
        ohlcv: "okx-public-swap-candles",
        notes: DATA_SOURCE_NOTES,
      },
      market: env,
      focus,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Analyze failed",
      },
      { status: 500 },
    );
  }
}
