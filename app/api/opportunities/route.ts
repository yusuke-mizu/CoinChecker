import { NextResponse } from "next/server";
import { apiError } from "@/lib/api/json-error";
import {
  MAX_BATCH,
  listOpportunityCandidates,
  scanOpportunities,
} from "@/lib/analysis/scan-opportunities";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Universe size, so the client knows how many slices to walk. */
export async function GET() {
  try {
    const candidates = await listOpportunityCandidates();
    return NextResponse.json({
      total: candidates.length,
      batchSize: MAX_BATCH,
      symbols: candidates.map((candidate) => candidate.symbol),
    });
  } catch (error) {
    return apiError(error, "Universe lookup failed");
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as {
      offset?: number;
      limit?: number;
    };
    const result = await scanOpportunities({
      offset: typeof body.offset === "number" ? body.offset : 0,
      limit: typeof body.limit === "number" ? body.limit : MAX_BATCH,
    });
    return NextResponse.json(result);
  } catch (error) {
    return apiError(error, "Opportunity scan failed");
  }
}
