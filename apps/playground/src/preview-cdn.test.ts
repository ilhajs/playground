import { describe, expect, test } from "bun:test";
import {
  alienSignalsUrlFromStoreBundle,
  assertPreviewImportMapConsistent,
  buildPreviewImportMapFromPeers,
  effectBaseUrlFromIlhaBundle,
} from "./preview-cdn.ts";

describe("effectBaseUrlFromIlhaBundle", () => {
  test("parses version from ilha esm bundle import", () => {
    const src = `import*as n from"/effect@^4.0.0-rc.112/Effect?target=es2022";`;
    expect(effectBaseUrlFromIlhaBundle(src)).toBe("https://esm.sh/effect@4.0.0-rc.112/es2022");
  });
});

describe("alienSignalsUrlFromStoreBundle", () => {
  test("parses version from store esm bundle import", () => {
    const src = `from"/alien-signals@^3.2.1?target=es2022"`;
    expect(alienSignalsUrlFromStoreBundle(src)).toBe(
      "https://esm.sh/alien-signals@3.2.1/es2022/alien-signals.mjs",
    );
  });
});

describe("buildPreviewImportMapFromPeers", () => {
  test("singleton ilha URL is explicit; standalones pin deps ilha@ver", () => {
    const ilhaUrl = "https://esm.sh/ilha@0.14.0/es2022/ilha.mjs";
    const ilhaSrc = `from"/effect@^4.0.0-rc.112/Effect?target=es2022"`;
    const storeBase = "https://esm.sh/@ilha/store@0.7.14/es2022";
    const storeSrc = `from"/alien-signals@^3.2.1?target=es2022"`;
    const map = buildPreviewImportMapFromPeers(ilhaUrl, "0.14.0", ilhaSrc, {
      storeUrl: `${storeBase}/store.mjs`,
      formUrl: `${storeBase}/form.mjs`,
      bundleSource: storeSrc,
    });
    assertPreviewImportMapConsistent(map);
    expect(map.ilha).toBe(ilhaUrl);
    expect(map.quando).toContain("deps=ilha@0.14.0");
    expect(map["@ilha/store"]).toMatch(/@ilha\/store@[0-9]+\.[0-9]+\.[0-9]+\/es2022\/store\.mjs$/);
    expect(map["@ilha/store"]).not.toContain("standalone");
    expect(map["@ilha/store/form"]).toMatch(
      /@ilha\/store@[0-9]+\.[0-9]+\.[0-9]+\/es2022\/form\.mjs$/,
    );
    expect(map["@ilha/store/form"]).not.toContain("standalone");
    expect(map.effect).toContain("effect@4.0.0-rc.112");
    expect(map["effect/"]).toContain("effect@4.0.0-rc.112");
    expect(map["alien-signals"]).toContain("alien-signals@3.2.1");
    expect("sonner" in map).toBe(false);
    expect("areia/sonner" in map).toBe(false);
  });

  test("jsx runtimes match resolved ilha version", () => {
    const map = buildPreviewImportMapFromPeers(
      "https://esm.sh/ilha@0.14.0/es2022/ilha.mjs",
      "0.14.0",
    );
    expect(map["ilha/jsx-runtime"]).toBe("https://esm.sh/ilha@0.14.0/es2022/jsx-runtime.mjs");
  });
});
