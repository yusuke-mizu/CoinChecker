import { NextResponse } from "next/server";
import { saveModel, summarise } from "@/lib/server/model-store";
import { TRAIN_DEFAULTS, TRAIN_LIMITS, trainModel } from "@/lib/model/train";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Trains a new model version and stores it.
 *
 * Deliberately a manual, occasional operation rather than something the scan
 * triggers: fetching deep history and fitting six heads is far too heavy for a
 * request that a user is waiting on. Inference against a stored model is only a
 * handful of dot products, which is what keeps the scan fast.
 */
export async function GET() {
  return NextResponse.json({
    success: true,
    defaults: TRAIN_DEFAULTS,
    limits: TRAIN_LIMITS,
  });
}

export async function POST(request: Request) {
  const started = Date.now();
  try {
    const body = (await request.json().catch(() => ({}))) as {
      symbols?: string[];
      barsPerSymbol?: number;
      combosPerBar?: number;
      stride?: number;
      walkForwardFolds?: number;
      activate?: boolean;
    };

    const progress: string[] = [];
    const model = await trainModel(
      {
        ...(Array.isArray(body.symbols) && body.symbols.length ? { symbols: body.symbols } : {}),
        ...(body.barsPerSymbol ? { barsPerSymbol: body.barsPerSymbol } : {}),
        ...(body.combosPerBar ? { combosPerBar: body.combosPerBar } : {}),
        ...(body.stride ? { stride: body.stride } : {}),
        ...(body.walkForwardFolds != null ? { walkForwardFolds: body.walkForwardFolds } : {}),
      },
      (message) => progress.push(message),
    );

    const summary = await saveModel(model, body.activate !== false);
    return NextResponse.json({
      success: true,
      summary,
      version: model.version,
      elapsedMs: Date.now() - started,
      training: model.training,
      walkForward: model.walkForward,
      notes: model.notes,
      progress,
    });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : String(error),
        elapsedMs: Date.now() - started,
      },
      { status: 500 },
    );
  }
}

export { summarise };
