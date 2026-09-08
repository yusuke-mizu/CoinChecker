import { NextResponse } from "next/server";
import {
  activateModel,
  activeVersion,
  listModels,
  readActiveModel,
  readModel,
} from "@/lib/server/model-store";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Model inspection.
 *
 * `?version=` returns one model in full (coefficients, calibration, folds);
 * without it the response carries the active model plus the version index, so
 * the analytics screen can render calibration without a second round trip.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const version = url.searchParams.get("version");
  try {
    if (version) {
      const model = await readModel(version);
      if (!model) {
        return NextResponse.json(
          { success: false, error: `model ${version} not found` },
          { status: 404 },
        );
      }
      return NextResponse.json({ success: true, model });
    }
    const [model, versions, active] = await Promise.all([
      readActiveModel(),
      listModels(),
      activeVersion(),
    ]);
    return NextResponse.json({ success: true, active, model, versions });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}

/** Promotes an already-stored version to active. Never rewrites the model itself. */
export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as { version?: string };
    if (!body.version) {
      return NextResponse.json({ success: false, error: "version is required" }, { status: 400 });
    }
    const ok = await activateModel(body.version);
    if (!ok) {
      return NextResponse.json(
        { success: false, error: `model ${body.version} not found` },
        { status: 404 },
      );
    }
    return NextResponse.json({ success: true, active: body.version });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}
