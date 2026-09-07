import { NextResponse } from "next/server";
import { analyzeSymbol } from "@/lib/analysis/analyze-symbol";
import { loadMarketEnv } from "@/lib/analysis/market-env";
import { toCompactUsdt } from "@/lib/market-data/provider";
import { mapPool } from "@/lib/util/pool";
import type { SharedMarketContext, TimeframeIndicators } from "@/lib/types/scoring";
import type { TickerSnapshot } from "@/lib/types/market";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MAX_SYMBOLS = 8;

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as {
      symbols?: string[];
      btc4h?: TimeframeIndicators | null;
      btc1hCloses?: number[];
      dominancePct?: number | null;
      tickers?: Record<string, TickerSnapshot>;
      venues?: Record<string, import("@/lib/types/venue").CandleVenue>;
    };
    const symbols = [...new Set((body.symbols ?? []).map(toCompactUsdt))].slice(0, MAX_SYMBOLS);
    if (symbols.length === 0) {
      return NextResponse.json({ error: "symbols required" }, { status: 400 });
    }

    let context: SharedMarketContext = {
      btc4h: body.btc4h ?? null,
      btc1hCloses: body.btc1hCloses ?? [],
      dominancePct: body.dominancePct ?? null,
        tickers: body.tickers,
        venues: body.venues,
      };
    if (!context.btc4h || context.btc1hCloses.length === 0) {
      const env = await loadMarketEnv();
      context = {
        btc4h: context.btc4h ?? env.btc4h,
        btc1hCloses: context.btc1hCloses.length ? context.btc1hCloses : env.btc1hCloses,
        dominancePct: context.dominancePct ?? env.dominancePct,
        tickers: context.tickers,
        venues: context.venues,
      };
    }

    const results = await mapPool(symbols, 3, async (symbol) => {
      try {
        return await analyzeSymbol(symbol, context);
      } catch (error) {
        return {
          symbol,
          display: symbol,
          status: "DATA_ERROR" as const,
          ticker: context.tickers?.[symbol] ?? null,
          long: null,
          short: null,
          difference: null,
          bias: null,
          signal: "DATA ERROR" as const,
          indicators: {},
          updatedAt: new Date().toISOString(),
          notes: [error instanceof Error ? error.message : String(error)],
          dataSource: "okx-swap-public",
          btcCorrelation: null,
          rankLong: null,
          rankShort: null,
          reversal: null,
          futures: null,
          contract: null,
        };
      }
    });

    return NextResponse.json({ results });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Batch analyze failed" },
      { status: 500 },
    );
  }
}
