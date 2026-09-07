/**
 * Browser-side helper: never call response.json() blindly.
 * Workers / Next error pages and SPA fallbacks return HTML (<!DOCTYPE ...).
 */
export async function readApiJson<T>(
  response: Response,
  label: string,
): Promise<T> {
  const contentType = response.headers.get("content-type") ?? "";
  const text = await response.text();
  const trimmed = text.trimStart();

  if (trimmed.startsWith("<!") || trimmed.startsWith("<html") || trimmed.startsWith("<HTML")) {
    throw new Error(
      `${label}: expected JSON but got HTML (HTTP ${response.status} ${response.statusText}; content-type=${contentType || "none"}). ` +
        `Usually /api/* missed the Worker route, timed out, or returned a Next/Cloudflare error page.`,
    );
  }

  if (!contentType.includes("application/json") && !trimmed.startsWith("{") && !trimmed.startsWith("[")) {
    throw new Error(
      `${label}: expected JSON (HTTP ${response.status}; content-type=${contentType || "none"}). Body starts with: ${trimmed.slice(0, 80)}`,
    );
  }

  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(
      `${label}: JSON parse failed (HTTP ${response.status}; content-type=${contentType || "none"})`,
    );
  }
}

export async function fetchApiJson<T>(
  input: RequestInfo | URL,
  init: RequestInit | undefined,
  label: string,
): Promise<{ response: Response; data: T }> {
  const response = await fetch(input, init);
  const data = await readApiJson<T>(response, label);
  return { response, data };
}
