import { NextResponse } from "next/server";
import { apiError } from "@/lib/api/json-error";
import { runBacktest } from "@/lib/simulation/run-backtest";
import { normalizeSettings } from "@/lib/simulation/settings";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const settings = normalizeSettings((body as { settings?: unknown })?.settings ?? body);
    const result = await runBacktest(settings);
    return NextResponse.json(result);
  } catch (error) {
    return apiError(error, "Backtest failed");
  }
}
