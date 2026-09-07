import { NextResponse } from "next/server";
import { loadUniverse } from "@/lib/analysis/universe";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET() {
  try {
    const universe = await loadUniverse();
    return NextResponse.json(universe);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Universe failed" },
      { status: 500 },
    );
  }
}
