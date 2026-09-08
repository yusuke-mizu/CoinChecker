import "server-only";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import type { PredictionRecord, PredictionResult } from "@/lib/types/prediction";

/**
 * Prediction log.
 *
 * Every stated probability is written down with the features that produced it
 * and the model version that produced it, before the outcome is known. When the
 * horizon elapses the realised outcome is attached to the same record; the
 * prediction itself is never edited. That is what makes the calibration screen
 * a measurement rather than a restatement of the model's own confidence.
 */

const LOG_KEY = "predictions:v1:log";
const LOG_TTL_SECONDS = 60 * 24 * 60 * 60;
/** KV values cap at 25MB; this keeps the document comfortably inside that. */
const MAX_RECORDS = 4000;

function kv(): KVNamespace | null {
  try {
    return getCloudflareContext().env.SIGNAL_METADATA ?? null;
  } catch {
    return null;
  }
}

export type PredictionLog = {
  version: 1;
  records: PredictionRecord[];
  updatedAt: string;
};

export function emptyLog(): PredictionLog {
  return { version: 1, records: [], updatedAt: new Date().toISOString() };
}

export async function readPredictionLog(): Promise<PredictionLog> {
  const store = kv();
  if (!store) return emptyLog();
  const stored = await store.get<PredictionLog>(LOG_KEY, "json");
  if (!stored || stored.version !== 1 || !Array.isArray(stored.records)) return emptyLog();
  return stored;
}

async function write(log: PredictionLog): Promise<void> {
  const store = kv();
  if (!store) throw new Error("SIGNAL_METADATA KV binding is unavailable");
  await store.put(LOG_KEY, JSON.stringify(log), { expirationTtl: LOG_TTL_SECONDS });
}

/** Appends predictions, de-duplicating on id and keeping the newest records. */
export async function appendPredictions(records: PredictionRecord[]): Promise<PredictionLog> {
  const log = await readPredictionLog();
  const byId = new Map(log.records.map((record) => [record.id, record]));
  for (const record of records) {
    // An existing record is never overwritten: what was predicted at the time
    // stands, even if the same symbol is scanned again a second later.
    if (!byId.has(record.id)) byId.set(record.id, record);
  }
  const merged = Array.from(byId.values())
    .sort((a, b) => b.timestamp.localeCompare(a.timestamp))
    .slice(0, MAX_RECORDS);
  const next: PredictionLog = {
    version: 1,
    records: merged,
    updatedAt: new Date().toISOString(),
  };
  await write(next);
  return next;
}

export async function attachResults(
  results: Array<{ id: string; result: PredictionResult }>,
): Promise<PredictionLog> {
  const log = await readPredictionLog();
  const byId = new Map(results.map((entry) => [entry.id, entry.result]));
  const next: PredictionLog = {
    version: 1,
    records: log.records.map((record) => {
      const result = byId.get(record.id);
      // Results are write-once for the same reason predictions are.
      return result && !record.result ? { ...record, result } : record;
    }),
    updatedAt: new Date().toISOString(),
  };
  await write(next);
  return next;
}

/** Records whose horizon has elapsed but which have no outcome attached yet. */
export function pendingResolutions(log: PredictionLog, now = Date.now()): PredictionRecord[] {
  return log.records.filter(
    (record) => !record.result && Date.parse(record.resolvesAt) <= now,
  );
}
