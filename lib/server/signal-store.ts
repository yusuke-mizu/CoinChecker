import "server-only";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { DEFAULT_SIGNAL_SETTINGS } from "@/lib/scoring/signal-tracking";
import type { SignalStoreDocument } from "@/lib/types/signals";

const STORE_KEY = "signals:v1:shared";
const STORE_TTL_SECONDS = 15 * 24 * 60 * 60;

function signalKv(): KVNamespace {
  const binding = getCloudflareContext().env.SIGNAL_METADATA;
  if (!binding) throw new Error("SIGNAL_METADATA KV binding is unavailable");
  return binding;
}

export function emptySignalStore(now = new Date().toISOString()): SignalStoreDocument {
  return {
    version: 1,
    settings: DEFAULT_SIGNAL_SETTINGS,
    signals: [],
    updatedAt: now,
  };
}

export async function readSignalStore(): Promise<SignalStoreDocument> {
  const stored = await signalKv().get<SignalStoreDocument>(STORE_KEY, "json");
  if (
    !stored ||
    stored.version !== 1 ||
    !Array.isArray(stored.signals) ||
    !stored.settings
  ) {
    return emptySignalStore();
  }
  return stored;
}

export async function writeSignalStore(document: SignalStoreDocument): Promise<void> {
  const kv = signalKv();
  const value = JSON.stringify(document);
  try {
    await kv.put(STORE_KEY, value, { expirationTtl: STORE_TTL_SECONDS });
  } catch (error) {
    if (!String(error).includes("429")) throw error;
    await new Promise((resolve) => setTimeout(resolve, 1100));
    await kv.put(STORE_KEY, value, { expirationTtl: STORE_TTL_SECONDS });
  }
}
