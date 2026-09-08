import "server-only";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import type { ModelSummary, TrainedModel } from "@/lib/types/prediction";

/**
 * Model persistence.
 *
 * This project has no database — the only durable store wired into the Worker
 * is the `SIGNAL_METADATA` KV namespace — so trained models live there under a
 * separate key prefix. Versions are immutable: `ACTIVE_KEY` only ever holds a
 * pointer, so publishing a new model never rewrites what an older prediction
 * was scored with.
 */

const ACTIVE_KEY = "model:v1:active";
const MODEL_PREFIX = "model:v1:version:";
const INDEX_KEY = "model:v1:index";
const MODEL_TTL_SECONDS = 90 * 24 * 60 * 60;

function kv(): KVNamespace | null {
  try {
    return getCloudflareContext().env.SIGNAL_METADATA ?? null;
  } catch {
    return null;
  }
}

export function summarise(model: TrainedModel): ModelSummary {
  return {
    version: model.version,
    createdAt: model.createdAt,
    totalRows: model.training.totalRows,
    symbols: model.training.symbols.length,
    longTargetAuc: model.long.target.metrics.auc,
    longTargetBrier: model.long.target.metrics.brier,
    shortTargetAuc: model.short.target.metrics.auc,
    shortTargetBrier: model.short.target.metrics.brier,
    walkForwardFolds: model.walkForward.length,
  };
}

export async function readActiveModel(): Promise<TrainedModel | null> {
  const store = kv();
  if (!store) return null;
  const version = await store.get(ACTIVE_KEY, "text");
  if (!version) return null;
  return store.get<TrainedModel>(`${MODEL_PREFIX}${version}`, "json");
}

export async function readModel(version: string): Promise<TrainedModel | null> {
  const store = kv();
  if (!store) return null;
  return store.get<TrainedModel>(`${MODEL_PREFIX}${version}`, "json");
}

export async function listModels(): Promise<ModelSummary[]> {
  const store = kv();
  if (!store) return [];
  const index = await store.get<ModelSummary[]>(INDEX_KEY, "json");
  return index ?? [];
}

export async function activeVersion(): Promise<string | null> {
  const store = kv();
  if (!store) return null;
  return store.get(ACTIVE_KEY, "text");
}

export async function saveModel(model: TrainedModel, activate = true): Promise<ModelSummary> {
  const store = kv();
  if (!store) throw new Error("SIGNAL_METADATA KV binding is unavailable");
  const summary = summarise(model);
  await store.put(`${MODEL_PREFIX}${model.version}`, JSON.stringify(model), {
    expirationTtl: MODEL_TTL_SECONDS,
  });
  const index = await listModels();
  const next = [summary, ...index.filter((entry) => entry.version !== model.version)].slice(0, 20);
  await store.put(INDEX_KEY, JSON.stringify(next), { expirationTtl: MODEL_TTL_SECONDS });
  if (activate) await store.put(ACTIVE_KEY, model.version, { expirationTtl: MODEL_TTL_SECONDS });
  return summary;
}

export async function activateModel(version: string): Promise<boolean> {
  const store = kv();
  if (!store) return false;
  const exists = await store.get(`${MODEL_PREFIX}${version}`, "text");
  if (!exists) return false;
  await store.put(ACTIVE_KEY, version, { expirationTtl: MODEL_TTL_SECONDS });
  return true;
}
