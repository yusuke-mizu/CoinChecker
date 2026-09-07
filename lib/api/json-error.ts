import { NextResponse } from "next/server";

/**
 * Shared JSON error shape for Route Handlers.
 * Keeps Cloudflare/Next from surfacing HTML error pages when we control the catch.
 */
export function apiError(error: unknown, fallback: string, status = 500) {
  return NextResponse.json(
    {
      success: false,
      error: error instanceof Error ? error.message : fallback,
    },
    { status },
  );
}
