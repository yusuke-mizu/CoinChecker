import { NextResponse } from "next/server";
import { computeLiveCalibration } from "@/lib/model/live-calibration";
import { resolvePredictions } from "@/lib/model/resolve";
import {
  appendPredictions,
  attachResults,
  pendingResolutions,
  readPredictionLog,
} from "@/lib/server/prediction-store";
import type { PredictionRecord } from "@/lib/types/prediction";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MAX_APPEND = 200;
/** Resolving pulls candles per symbol, so a single request only clears a slice. */
const MAX_RESOLVE_SYMBOLS = 40;

/**
 * GET returns the live calibration report and, on the way, resolves any
 * predictions whose horizon has elapsed. Resolution is folded into the read
 * because this project has no scheduler: opening the analytics screen is what
 * advances the outcome log.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const skipResolve = url.searchParams.get("resolve") === "0";
  try {
    let log = await readPredictionLog();
    let resolvedNow = 0;

    if (!skipResolve) {
      const due = pendingResolutions(log).slice(0, MAX_RESOLVE_SYMBOLS * 4);
      if (due.length > 0) {
        const results = await resolvePredictions(due);
        if (results.length > 0) {
          log = await attachResults(results);
          resolvedNow = results.length;
        }
      }
    }

    return NextResponse.json({
      success: true,
      calibration: computeLiveCalibration(log.records),
      resolvedNow,
      total: log.records.length,
      updatedAt: log.updatedAt,
    });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}

/** Appends predictions. Existing ids are left untouched, never rewritten. */
export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as { records?: PredictionRecord[] };
    const records = Array.isArray(body.records) ? body.records.slice(0, MAX_APPEND) : [];
    if (records.length === 0) {
      return NextResponse.json({ success: false, error: "records is required" }, { status: 400 });
    }
    const log = await appendPredictions(records);
    return NextResponse.json({ success: true, stored: log.records.length }, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}
