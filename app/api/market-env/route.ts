import { NextResponse } from "next/server";
import { loadMarketEnv } from "@/lib/analysis/market-env";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET() {
  try {
    const env = await loadMarketEnv();
    return NextResponse.json(env);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Market env failed" },
      { status: 500 },
    );
  }
}
