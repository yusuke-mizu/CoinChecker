import { NextResponse } from "next/server";
import { runPhase13 } from "@/lib/analysis/phase13";
import { apiError } from "@/lib/api/json-error";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST() {
  try {
    const result = await runPhase13();
    return NextResponse.json(result);
  } catch (error) {
    return apiError(error, "Phase 1-3 failed");
  }
}
