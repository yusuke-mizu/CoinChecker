import { NextResponse } from "next/server";
import { loadMarketEnv } from "@/lib/analysis/market-env";
import { apiError } from "@/lib/api/json-error";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET() {
  try {
    const env = await loadMarketEnv();
    return NextResponse.json(env);
  } catch (error) {
    return apiError(error, "Market env failed");
  }
}
