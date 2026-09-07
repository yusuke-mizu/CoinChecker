import { NextResponse } from "next/server";
import { loadUniverse } from "@/lib/analysis/universe";
import { apiError } from "@/lib/api/json-error";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET() {
  try {
    const universe = await loadUniverse();
    return NextResponse.json(universe);
  } catch (error) {
    return apiError(error, "Universe failed");
  }
}
