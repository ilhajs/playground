/** Retry, dedupe, cache, and concurrency limit for browser CDN fetches (esm.sh, etc.). */

const DEFAULT_MAX_ATTEMPTS = 3;
const RETRY_DELAYS_MS = [300, 900, 2200];
const SESSION_CACHE_TTL_MS = 10 * 60 * 1000;
const DEFAULT_MAX_CONCURRENT = 6;

export type ReliableFetchOptions = {
  maxAttempts?: number;
  maxConcurrent?: number;
  cacheTtlMs?: number;
  /** Only cache GET responses with these status codes (default 200). */
  cacheStatuses?: number[];
};

type CacheEntry = {
  body: string;
  status: number;
  statusText: string;
  headers: [string, string][];
  at: number;
};

function jitter(ms: number): number {
  return ms + Math.floor(Math.random() * ms * 0.25);
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function isRetryableNetworkError(err: unknown): boolean {
  if (!(err instanceof TypeError)) return false;
  const msg = err.message.toLowerCase();
  return (
    msg.includes("failed to fetch") ||
    msg.includes("networkerror") ||
    msg.includes("load failed") ||
    msg.includes("network request failed")
  );
}

function isRetryableStatus(status: number): boolean {
  return status === 429 || status === 502 || status === 503 || status === 504;
}

function requestKey(input: RequestInfo | URL, init?: RequestInit): string {
  const method = (init?.method ?? "GET").toUpperCase();
  const url =
    typeof input === "string"
      ? input
      : input instanceof URL
        ? input.href
        : input instanceof Request
          ? input.url
          : String(input);
  return `${method} ${url}`;
}

function cloneInit(init?: RequestInit): RequestInit | undefined {
  if (!init) return undefined;
  return { ...init, headers: init.headers ? new Headers(init.headers) : undefined };
}

export type ReliableFetchFn = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export function createReliableFetcher(options: ReliableFetchOptions = {}): ReliableFetchFn {
  const maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  const maxConcurrent = options.maxConcurrent ?? DEFAULT_MAX_CONCURRENT;
  const cacheTtlMs = options.cacheTtlMs ?? SESSION_CACHE_TTL_MS;
  const cacheStatuses = options.cacheStatuses ?? [200];

  const sessionCache = new Map<string, CacheEntry>();
  const inFlight = new Map<string, Promise<Response>>();
  let active = 0;
  const queue: (() => void)[] = [];

  function pumpQueue(): void {
    while (active < maxConcurrent && queue.length > 0) {
      const run = queue.shift();
      run?.();
    }
  }

  function schedule<T>(fn: () => Promise<T>): Promise<T> {
    return new Promise((resolve, reject) => {
      const run = () => {
        active++;
        fn()
          .then(resolve, reject)
          .finally(() => {
            active--;
            pumpQueue();
          });
      };
      if (active < maxConcurrent) run();
      else queue.push(run);
    });
  }

  async function fetchOnce(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    let lastErr: unknown;
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        const res = await fetch(input, init);
        if (res.ok || !isRetryableStatus(res.status) || attempt === maxAttempts - 1) {
          return res;
        }
        await res.body?.cancel().catch(() => {});
        lastErr = new Error(`HTTP ${res.status}`);
      } catch (err) {
        lastErr = err;
        if (!isRetryableNetworkError(err) || attempt === maxAttempts - 1) throw err;
      }
      await sleep(jitter(RETRY_DELAYS_MS[attempt] ?? 2000));
    }
    throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
  }

  function readCache(key: string, method: string): Response | null {
    if (method !== "GET") return null;
    const hit = sessionCache.get(key);
    if (!hit || Date.now() - hit.at > cacheTtlMs) {
      if (hit) sessionCache.delete(key);
      return null;
    }
    return new Response(hit.body, {
      status: hit.status,
      statusText: hit.statusText,
      headers: hit.headers,
    });
  }

  async function maybeCache(key: string, method: string, res: Response): Promise<Response> {
    if (method !== "GET" || !cacheStatuses.includes(res.status)) return res;
    const clone = res.clone();
    const body = await clone.text();
    sessionCache.set(key, {
      body,
      status: res.status,
      statusText: res.statusText,
      headers: [...res.headers.entries()],
      at: Date.now(),
    });
    return new Response(body, {
      status: res.status,
      statusText: res.statusText,
      headers: res.headers,
    });
  }

  const reliableFetch: ReliableFetchFn = (input, init) => {
    const key = requestKey(input, init);
    const method = (init?.method ?? "GET").toUpperCase();

    const cached = readCache(key, method);
    if (cached) return Promise.resolve(cached.clone());

    const existing = inFlight.get(key);
    if (existing) return existing.then((r) => r.clone());

    const work = schedule(async () => {
      const res = await fetchOnce(input, cloneInit(init));
      return maybeCache(key, method, res);
    });

    const shared = work.finally(() => {
      inFlight.delete(key);
    });
    inFlight.set(key, shared);
    return shared.then((r) => r.clone());
  };

  return reliableFetch;
}

/** Default fetcher for esm.sh / Twoslash ATA (module singleton). */
let defaultReliableFetch: ReliableFetchFn | null = null;

export function getReliableCdnFetch(): ReliableFetchFn {
  if (!defaultReliableFetch) defaultReliableFetch = createReliableFetcher();
  return defaultReliableFetch;
}
