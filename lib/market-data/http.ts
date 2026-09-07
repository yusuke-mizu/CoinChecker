export class HttpError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly code?: "RATE_LIMIT" | "TIMEOUT" | "NETWORK" | "HTTP",
  ) {
    super(message);
    this.name = "HttpError";
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function fetchJson<T>(
  url: string,
  options: {
    timeoutMs?: number;
    retries?: number;
    headers?: Record<string, string>;
  } = {},
): Promise<T> {
  const timeoutMs = options.timeoutMs ?? 12_000;
  const retries = options.retries ?? 2;
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, {
        signal: controller.signal,
        headers: {
          accept: "application/json",
          "user-agent": "coin-checker/0.1 (market-analysis; no-trading)",
          ...options.headers,
        },
        cache: "no-store",
      });

      if (response.status === 429) {
        const retryAfter = Number(response.headers.get("retry-after") ?? "2");
        if (attempt < retries) {
          await sleep(Math.min(8_000, (Number.isFinite(retryAfter) ? retryAfter : 2) * 1000));
          continue;
        }
        throw new HttpError(`Rate limited: ${url}`, 429, "RATE_LIMIT");
      }

      if (!response.ok) {
        throw new HttpError(
          `HTTP ${response.status} for ${url}`,
          response.status,
          "HTTP",
        );
      }

      return (await response.json()) as T;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      if (lastError.name === "AbortError") {
        lastError = new HttpError(`Timeout fetching ${url}`, undefined, "TIMEOUT");
      }
      const retryable =
        lastError.name === "TypeError" ||
        (lastError instanceof HttpError &&
          (lastError.code === "TIMEOUT" || lastError.code === "RATE_LIMIT"));
      if (attempt < retries && retryable) {
        await sleep(400 * (attempt + 1));
        continue;
      }
      throw lastError;
    } finally {
      clearTimeout(timer);
    }
  }

  throw lastError ?? new HttpError(`Failed fetching ${url}`, undefined, "NETWORK");
}
