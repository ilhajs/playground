import { describe, expect, test } from "bun:test";
import {
  alienSignalsUrlFromStoreBundle,
  assertPreviewImportMapConsistent,
  buildPreviewImportMapFromPeers,
  effectBaseUrlFromIlhaBundle,
  parseEsmShPeerImports,
} from "./preview-cdn.ts";

const AREIA_STUB = `/* esm.sh - areia@0.3.2 */
import "/ilha@0.14.0/es2022/ilha.mjs";
import "/sonner@2.0.7/es2022/sonner.mjs";
import "/tailwindcss@>=4.0.0/plugin?target=es2022";
export * from "/areia@0.1.28/foo/areia.bundle.mjs";
`;

describe("parseEsmShPeerImports", () => {
  test("extracts versioned peer URLs", () => {
    const peers = parseEsmShPeerImports(AREIA_STUB);
    expect(peers.get("ilha")).toBe("https://esm.sh/ilha@0.14.0/es2022/ilha.mjs");
    expect(peers.get("sonner")).toBe("https://esm.sh/sonner@2.0.7/es2022/sonner.mjs");
  });
});

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
    const sonnerUrl = "https://esm.sh/sonner@2.0.7/es2022/sonner.mjs";
    const areiaSonnerUrl = "https://esm.sh/areia@0.1.28/es2022/sonner.mjs";
    const map = buildPreviewImportMapFromPeers(
      ilhaUrl,
      parseEsmShPeerImports(AREIA_STUB),
      "0.14.0",
      ilhaSrc,
      {
        storeUrl: `${storeBase}/store.mjs`,
        formUrl: `${storeBase}/form.mjs`,
        bundleSource: storeSrc,
      },
      sonnerUrl,
      areiaSonnerUrl,
    );
    assertPreviewImportMapConsistent(map);
    expect(map.ilha).toBe(ilhaUrl);
    expect(map.areia).toContain("deps=ilha@0.14.0,sonner");
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
    expect(map.sonner).toBe(sonnerUrl);
    expect(map.sonner).not.toContain("standalone");
    expect(map["areia/sonner"]).toBe(areiaSonnerUrl);
  });

  test("jsx runtimes match resolved ilha version", () => {
    const map = buildPreviewImportMapFromPeers(
      "https://esm.sh/ilha@0.14.0/es2022/ilha.mjs",
      parseEsmShPeerImports(AREIA_STUB),
      "0.14.0",
    );
    expect(map["ilha/jsx-runtime"]).toBe("https://esm.sh/ilha@0.14.0/es2022/jsx-runtime.mjs");
  });
});
