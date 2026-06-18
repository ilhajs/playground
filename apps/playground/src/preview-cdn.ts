/**
 * Preview iframe CDN import map.
 *
 * Rule: anything that must be a **singleton** (ilha bind context, sonner toast store)
 * uses a pinned `/es2022/*.mjs` URL — never `?standalone` stubs.
 *
 * `?standalone` packages must list those singletons in `deps=` with the **same versions**
 * so esm.sh resolves peers to the import-map URLs.
 */

export const PREVIEW_ESM_ORIGIN = "https://esm.sh";
export const PREVIEW_ESM_TARGET = "es2022";

/** Bump when areia/quando peer graph changes. */
export const PREVIEW_RUNTIME_VERSIONS = {
  ilha: "0.8.0",
  sonner: "2.0.7",
} as const;

export type PreviewRuntimeKey =
  | keyof typeof PREVIEW_RUNTIME_VERSIONS
  | "ilha/jsx-runtime"
  | "ilha/jsx-dev-runtime";

/** Canonical module URLs — one instance per preview iframe. */
export const PREVIEW_RUNTIME_URLS: Record<PreviewRuntimeKey, string> = {
  ilha: `${PREVIEW_ESM_ORIGIN}/ilha@${PREVIEW_RUNTIME_VERSIONS.ilha}/${PREVIEW_ESM_TARGET}/ilha.mjs`,
  sonner: `${PREVIEW_ESM_ORIGIN}/sonner@${PREVIEW_RUNTIME_VERSIONS.sonner}/${PREVIEW_ESM_TARGET}/sonner.mjs`,
  "ilha/jsx-runtime": `${PREVIEW_ESM_ORIGIN}/ilha@${PREVIEW_RUNTIME_VERSIONS.ilha}/${PREVIEW_ESM_TARGET}/jsx-runtime.mjs`,
  "ilha/jsx-dev-runtime": `${PREVIEW_ESM_ORIGIN}/ilha@${PREVIEW_RUNTIME_VERSIONS.ilha}/${PREVIEW_ESM_TARGET}/jsx-dev-runtime.mjs`,
};

export type PreviewStandalonePackage = {
  /** Import map key (e.g. `"areia"`). */
  name: string;
  /** esm package name if different from map key. */
  pkg?: string;
  /** Import-map keys this bundle must share — each must exist in {@link PREVIEW_RUNTIME_URLS}. */
  sharedDeps: (keyof typeof PREVIEW_RUNTIME_VERSIONS)[];
};

/** Standalone bundles only — peers must be listed in `sharedDeps`. */
export const PREVIEW_STANDALONE_PACKAGES: PreviewStandalonePackage[] = [
  { name: "areia", sharedDeps: ["ilha", "sonner"] },
  { name: "quando", sharedDeps: ["ilha"] },
];

function esmDepsParam(sharedDeps: PreviewStandalonePackage["sharedDeps"]): string {
  return sharedDeps.map((key) => `${key}@${PREVIEW_RUNTIME_VERSIONS[key]}`).join(",");
}

function standaloneEntry(pkg: string, sharedDeps: PreviewStandalonePackage["sharedDeps"]): string {
  const q = ["standalone", `target=${PREVIEW_ESM_TARGET}`, `deps=${esmDepsParam(sharedDeps)}`].join(
    "&",
  );
  return `${PREVIEW_ESM_ORIGIN}/${pkg}?${q}`;
}

/** Import map sent to esm.sh/transform and injected into the preview iframe. */
export function buildPreviewImportMap(): Record<string, string> {
  const imports: Record<string, string> = {
    ilha: PREVIEW_RUNTIME_URLS.ilha,
    sonner: PREVIEW_RUNTIME_URLS.sonner,
    "ilha/jsx-runtime": PREVIEW_RUNTIME_URLS["ilha/jsx-runtime"],
    "ilha/jsx-dev-runtime": PREVIEW_RUNTIME_URLS["ilha/jsx-dev-runtime"],
    "react/jsx-runtime": PREVIEW_RUNTIME_URLS["ilha/jsx-runtime"],
    "react/jsx-dev-runtime": PREVIEW_RUNTIME_URLS["ilha/jsx-dev-runtime"],
  };

  for (const spec of PREVIEW_STANDALONE_PACKAGES) {
    const pkg = spec.pkg ?? spec.name;
    imports[spec.name] = standaloneEntry(pkg, spec.sharedDeps);
  }

  return imports;
}

/** Dev-time guard: every standalone `sharedDeps` key must use a runtime URL in the map. */
export function assertPreviewImportMapConsistent(map: Record<string, string>): void {
  const runtimeKeys = new Set(Object.keys(PREVIEW_RUNTIME_URLS));
  for (const key of runtimeKeys) {
    if (map[key] !== PREVIEW_RUNTIME_URLS[key as PreviewRuntimeKey]) {
      throw new Error(
        `preview import map: "${key}" must be ${PREVIEW_RUNTIME_URLS[key as PreviewRuntimeKey]}, got ${map[key]}`,
      );
    }
  }

  for (const spec of PREVIEW_STANDALONE_PACKAGES) {
    for (const dep of spec.sharedDeps) {
      if (!map[dep]) {
        throw new Error(
          `preview import map: standalone "${spec.name}" needs shared dep "${dep}" in map`,
        );
      }
      if (map[dep].includes("standalone")) {
        throw new Error(`preview import map: shared dep "${dep}" must not use ?standalone`);
      }
    }
    const entry = map[spec.name];
    if (!entry?.includes("standalone")) {
      throw new Error(`preview import map: "${spec.name}" must be a ?standalone entry`);
    }
    const expectedDeps = esmDepsParam(spec.sharedDeps);
    if (!entry.includes(`deps=${expectedDeps}`)) {
      throw new Error(
        `preview import map: "${spec.name}" deps= must be "${expectedDeps}" (got ${entry})`,
      );
    }
  }
}

export const PREVIEW_IMPORT_MAP = (() => {
  const map = buildPreviewImportMap();
  assertPreviewImportMapConsistent(map);
  return map;
})();

export const PREVIEW_TRANSFORM_URL = `${PREVIEW_ESM_ORIGIN}/transform`;
