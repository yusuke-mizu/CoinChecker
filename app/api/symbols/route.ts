import { NextResponse } from "next/server";
import { loadUniverse, toUsdtSymbol } from "@/lib/analysis/universe";
import { apiError } from "@/lib/api/json-error";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET() {
  try {
    const universe = await loadUniverse();
    return NextResponse.json({
      candidates: universe.candidates,
      count: universe.symbols.length,
      symbols: universe.symbols.map(toUsdtSymbol),
      error: universe.error,
      warning: universe.warning,
      source: universe.source,
    });
  } catch (error) {
    return apiError(error, "Symbols failed");
  }
}
