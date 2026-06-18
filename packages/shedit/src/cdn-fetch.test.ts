import { describe, expect, test } from "bun:test";
import { createReliableFetcher } from "./cdn-fetch.ts";

describe("createReliableFetcher", () => {
  test("dedupes concurrent GETs to the same URL", async () => {
    let hits = 0;
    const base = globalThis.fetch;
    globalThis.fetch = (async () => {
      hits++;
      await new Promise((r) => setTimeout(r, 30));
      return new Response("ok", { status: 200 });
    }) as unknown as typeof fetch;

    const reliable = createReliableFetcher({ maxConcurrent: 4, cacheTtlMs: 60_000 });
    const [a, b] = await Promise.all([
      reliable("https://example.test/pkg"),
      reliable("https://example.test/pkg"),
    ]);
    expect(await a.text()).toBe("ok");
    expect(await b.text()).toBe("ok");
    expect(hits).toBe(1);

    globalThis.fetch = base;
  });

  test("serves GET from session cache on second call", async () => {
    let hits = 0;
    const base = globalThis.fetch;
    globalThis.fetch = (async () => {
      hits++;
      return new Response("cached-body", { status: 200 });
    }) as unknown as typeof fetch;

    const reliable = createReliableFetcher({ cacheTtlMs: 60_000 });
    await reliable("https://example.test/cached");
    await reliable("https://example.test/cached");
    expect(hits).toBe(1);

    globalThis.fetch = base;
  });
});
