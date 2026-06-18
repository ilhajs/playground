import { describe, expect, test } from "bun:test";
import {
  PREVIEW_IMPORT_MAP,
  PREVIEW_RUNTIME_URLS,
  PREVIEW_STANDALONE_PACKAGES,
  assertPreviewImportMapConsistent,
  buildPreviewImportMap,
} from "./preview-cdn.ts";

// Re-export helper for tests only (mirror production builder)
function esmDepsParamForTest(sharedDeps: ("ilha" | "sonner")[]): string {
  return sharedDeps.map((key) => `${key}@${key === "ilha" ? "0.8.0" : "2.0.7"}`).join(",");
}

describe("preview import map", () => {
  test("buildPreviewImportMap passes consistency guard", () => {
    assertPreviewImportMapConsistent(buildPreviewImportMap());
  });

  test("singletons are pinned es2022 .mjs, not standalone", () => {
    expect(PREVIEW_IMPORT_MAP.ilha).toBe(PREVIEW_RUNTIME_URLS.ilha);
    expect(PREVIEW_IMPORT_MAP.sonner).toBe(PREVIEW_RUNTIME_URLS.sonner);
    expect(PREVIEW_IMPORT_MAP.ilha).not.toContain("standalone");
    expect(PREVIEW_IMPORT_MAP.sonner).not.toContain("standalone");
  });

  test("each standalone package declares deps matching runtime versions", () => {
    for (const spec of PREVIEW_STANDALONE_PACKAGES) {
      const entry = PREVIEW_IMPORT_MAP[spec.name]!;
      const deps = esmDepsParamForTest(spec.sharedDeps);
      expect(entry).toContain(`deps=${deps}`);
    }
  });

  test("adding a new standalone without sharedDeps in map would fail guard", () => {
    const bad = {
      ...buildPreviewImportMap(),
      areia: "https://esm.sh/areia?standalone&target=es2022",
    };
    expect(() => assertPreviewImportMapConsistent(bad)).toThrow(/deps=/);
  });
});
