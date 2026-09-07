import { NextResponse } from "next/server";
import { loadUniverse, toUsdtSymbol } from "@/lib/analysis/universe";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET() {
  try {
    const universe = await loadUniverse();
    return NextResponse.json({
      count: universe.symbols.length,
      symbols: universe.symbols.map(toUsdtSymbol),
      error: universe.error,
      warning: universe.warning,
      source: universe.source,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Symbols failed" },
      { status: 500 },
    );
  }
}
