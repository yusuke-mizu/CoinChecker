import "server-only";
import { getCloudflareContext } from "@opennextjs/cloudflare";

export function getServerSecret(name: string): string | null {
  const processValue = process.env[name]?.trim();
  if (processValue) return processValue;

  try {
    const env = getCloudflareContext().env as Record<string, unknown>;
    const value = env[name];
    return typeof value === "string" && value.trim() ? value.trim() : null;
  } catch {
    // next dev can run before the Wrangler-backed context is initialized.
    return null;
  }
}
