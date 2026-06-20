import { describe, expect, test } from "bun:test";
import {
  alienSignalsUrlFromIlhaBundle,
  assertPreviewImportMapConsistent,
  buildPreviewImportMapFromPeers,
  parseEsmShPeerImports,
} from "./preview-cdn.ts";

const AREIA_STUB = `/* esm.sh - areia@0.1.28 */
import "/ilha@0.8.1/es2022/ilha.mjs";
import "/sonner@2.0.7/es2022/sonner.mjs";
import "/tailwindcss@>=4.0.0/plugin?target=es2022";
export * from "/areia@0.1.28/foo/areia.bundle.mjs";
`;

describe("parseEsmShPeerImports", () => {
  test("extracts versioned peer URLs", () => {
    const peers = parseEsmShPeerImports(AREIA_STUB);
    expect(peers.get("ilha")).toBe("https://esm.sh/ilha@0.8.1/es2022/ilha.mjs");
    expect(peers.get("sonner")).toBe("https://esm.sh/sonner@2.0.7/es2022/sonner.mjs");
  });
});

describe("alienSignalsUrlFromIlhaBundle", () => {
  test("parses version from ilha esm bundle import", () => {
    const src = `import{signal as fe}from"/alien-signals@3.2.1/es2022/alien-signals.mjs";`;
    expect(alienSignalsUrlFromIlhaBundle(src)).toBe(
      "https://esm.sh/alien-signals@3.2.1/es2022/alien-signals.mjs",
    );
  });
});

describe("buildPreviewImportMapFromPeers", () => {
  test("singleton ilha URL is explicit; standalones pin deps ilha@ver", () => {
    const ilhaUrl = "https://esm.sh/ilha@0.8.1/es2022/ilha.mjs";
    const ilhaSrc = `from"/alien-signals@3.2.1/es2022/alien-signals.mjs"`;
    const storeBase = "https://esm.sh/@ilha/store@0.5.2/es2022";
    const map = buildPreviewImportMapFromPeers(
      ilhaUrl,
      parseEsmShPeerImports(AREIA_STUB),
      "0.8.1",
      ilhaSrc,
      { storeUrl: `${storeBase}/store.mjs`, formUrl: `${storeBase}/form.mjs` },
    );
    assertPreviewImportMapConsistent(map);
    expect(map.ilha).toBe(ilhaUrl);
    expect(map.areia).toContain("deps=ilha@0.8.1,sonner");
    expect(map.quando).toContain("deps=ilha@0.8.1");
    expect(map["@ilha/store"]).toMatch(/@ilha\/store@[0-9]+\.[0-9]+\.[0-9]+\/es2022\/store\.mjs$/);
    expect(map["@ilha/store"]).not.toContain("standalone");
    expect(map["@ilha/store/form"]).toMatch(
      /@ilha\/store@[0-9]+\.[0-9]+\.[0-9]+\/es2022\/form\.mjs$/,
    );
    expect(map["@ilha/store/form"]).not.toContain("standalone");
    expect(map["alien-signals"]).toContain("alien-signals@3.2.1");
  });

  test("jsx runtimes match resolved ilha version", () => {
    const map = buildPreviewImportMapFromPeers(
      "https://esm.sh/ilha@0.8.1/es2022/ilha.mjs",
      parseEsmShPeerImports(AREIA_STUB),
      "0.8.1",
    );
    expect(map["ilha/jsx-runtime"]).toBe("https://esm.sh/ilha@0.8.1/es2022/jsx-runtime.mjs");
  });
});
