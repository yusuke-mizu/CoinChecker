import { NextResponse } from "next/server";
import { apiError } from "@/lib/api/json-error";
import {
  CANDLE_PROBE_MAX,
  PRESCREEN_MAX,
  screenUniverse,
} from "@/lib/analysis/screen-universe";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function bounded(value: unknown, fallback: number, min: number, max: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.round(value)));
}

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as {
      prescreenSize?: number;
      candleProbeSize?: number;
      detailSize?: number;
    };
    const result = await screenUniverse({
      prescreenSize: bounded(body.prescreenSize, PRESCREEN_MAX, 10, PRESCREEN_MAX),
      candleProbeSize: bounded(body.candleProbeSize, 24, 0, CANDLE_PROBE_MAX),
      detailSize: bounded(body.detailSize, 25, 1, 30),
    });
    return NextResponse.json(result);
  } catch (error) {
    return apiError(error, "Screening failed");
  }
}
