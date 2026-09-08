import { NextResponse } from "next/server";
import { analyzeSymbol } from "@/lib/analysis/analyze-symbol";
import { loadMarketEnv } from "@/lib/analysis/market-env";
import { failedCandidateAnalysis } from "@/lib/analysis/listed-only";
import { apiError } from "@/lib/api/json-error";
import { toCompactUsdt } from "@/lib/market-data/provider";
import { mapPool } from "@/lib/util/pool";
import type { SharedMarketContext, TimeframeIndicators } from "@/lib/types/scoring";
import type { BtccCandidate, TickerSnapshot } from "@/lib/types/market";

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
      candidates?: Record<string, BtccCandidate>;
      hardStopPct?: number;
    };
    const symbols = [...new Set((body.symbols ?? []).map(toCompactUsdt))].slice(0, MAX_SYMBOLS);
    if (symbols.length === 0) {
      return NextResponse.json(
        { success: false, error: "symbols required" },
        { status: 400 },
      );
    }

    let context: SharedMarketContext = {
      btc4h: body.btc4h ?? null,
      btc1hCloses: body.btc1hCloses ?? [],
      dominancePct: body.dominancePct ?? null,
      tickers: body.tickers,
      venues: body.venues,
      candidates: body.candidates,
      hardStopPct:
        typeof body.hardStopPct === "number" && body.hardStopPct >= 1 && body.hardStopPct <= 25
          ? body.hardStopPct
          : 10,
    };
    if (!context.btc4h || context.btc1hCloses.length === 0) {
      const env = await loadMarketEnv();
      context = {
        btc4h: context.btc4h ?? env.btc4h,
        btc1hCloses: context.btc1hCloses.length ? context.btc1hCloses : env.btc1hCloses,
        dominancePct: context.dominancePct ?? env.dominancePct,
        tickers: context.tickers,
        venues: context.venues,
        candidates: context.candidates,
        hardStopPct: context.hardStopPct,
      };
    }

    const results = await mapPool(symbols, 3, async (symbol) => {
      try {
        return await analyzeSymbol(symbol, context);
      } catch (error) {
        return failedCandidateAnalysis({
          symbol,
          ticker: context.tickers?.[symbol] ?? null,
          candidate: context.candidates?.[symbol],
          venue: context.venues?.[symbol],
          error: error instanceof Error ? error.message : String(error),
        });
      }
    });

    return NextResponse.json({ results });
  } catch (error) {
    return apiError(error, "Batch analyze failed");
  }
}
