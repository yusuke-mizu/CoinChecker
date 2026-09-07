import { NextResponse } from "next/server";
import { runPhase13 } from "@/lib/analysis/phase13";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST() {
  try {
    const result = await runPhase13();
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Phase 1-3 failed",
      },
      { status: 500 },
    );
  }
}
