import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/**
 * Catch-all for unknown /api/* paths.
 * Prevents Next.js HTML 404 pages from being fed to response.json() in the browser.
 * Specific routes (universe, market-env, …) still take precedence.
 */
function notFound(path: string) {
  return NextResponse.json(
    {
      success: false,
      error: "API endpoint not found",
      path,
    },
    { status: 404 },
  );
}

type Ctx = { params: Promise<{ slug?: string[] }> };

async function handle(request: Request, ctx: Ctx) {
  const slug = (await ctx.params).slug?.join("/") ?? "";
  const path = `/api/${slug}`;
  return notFound(path);
}

export const GET = handle;
export const POST = handle;
export const PUT = handle;
export const PATCH = handle;
export const DELETE = handle;
