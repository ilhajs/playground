/** Preview iframe import map: one ilha + one sonner via esm.sh (resolved at runtime). */

export const PREVIEW_ESM_ORIGIN = "https://esm.sh";
export const PREVIEW_ESM_TARGET = "es2022";
export const PREVIEW_TRANSFORM_URL = `${PREVIEW_ESM_ORIGIN}/transform`;

export const PREVIEW_SHARED_RUNTIME_KEYS = ["ilha", "effect", "alien-signals"] as const;
export type PreviewSharedRuntimeKey = (typeof PREVIEW_SHARED_RUNTIME_KEYS)[number];

export type PreviewStandalonePackage = {
  name: string;
  pkg?: string;
  sharedDeps: PreviewSharedRuntimeKey[];
};

/**
 * Standalone esm.sh bundles inline their dependencies. quando must NOT be
 * standalone: it shares ilha — two copies break bind/render sync.
 * ilha 0.14+ shares effect the same way.
 */
export const PREVIEW_STANDALONE_PACKAGES: PreviewStandalonePackage[] = [
  { name: "quando", sharedDeps: ["ilha"] },
];

const ILHA_VER_RE = /ilha@([0-9]+\.[0-9]+\.[0-9]+)/;
const STORE_VER_RE = /@ilha\/store@([0-9]+\.[0-9]+\.[0-9]+)/;

async function resolveIlhaSingletonFromEsm(): Promise<{ version: string; url: string }> {
  const probe = `${PREVIEW_ESM_ORIGIN}/ilha?target=${PREVIEW_ESM_TARGET}`;
  const res = await fetch(probe);
  if (!res.ok) throw new Error(`preview CDN: esm.sh ilha probe → ${res.status}`);
  const stub = await res.text();
  const ver = stub.match(ILHA_VER_RE)?.[1];
  if (!ver) throw new Error("preview CDN: could not parse ilha version from esm.sh");
  const url = `${PREVIEW_ESM_ORIGIN}/ilha@${ver}/${PREVIEW_ESM_TARGET}/ilha.mjs`;
  return { version: ver, url };
}

async function resolveStoreFromEsm(): Promise<{
  version: string;
  storeUrl: string;
  formUrl: string;
}> {
  const probe = `${PREVIEW_ESM_ORIGIN}/@ilha/store?target=${PREVIEW_ESM_TARGET}`;
  const res = await fetch(probe);
  if (!res.ok) throw new Error(`preview CDN: esm.sh @ilha/store probe → ${res.status}`);
  const stub = await res.text();
  const ver = stub.match(STORE_VER_RE)?.[1];
  if (!ver) throw new Error("preview CDN: could not parse @ilha/store version from esm.sh");
  const base = `${PREVIEW_ESM_ORIGIN}/@ilha/store@${ver}/${PREVIEW_ESM_TARGET}`;
  return {
    version: ver,
    storeUrl: `${base}/store.mjs`,
    formUrl: `${base}/form.mjs`,
  };
}

function standaloneEntry(
  pkg: string,
  sharedDeps: PreviewStandalonePackage["sharedDeps"],
  ilhaVersion?: string,
): string {
  const deps = sharedDeps
    .map((d) => (d === "ilha" && ilhaVersion ? `ilha@${ilhaVersion}` : d))
    .join(",");
  const q = ["standalone", `target=${PREVIEW_ESM_TARGET}`, `deps=${deps}`].join("&");
  return `${PREVIEW_ESM_ORIGIN}/${pkg}?${q}`;
}

function ilhaJsxUrls(ilhaMainUrl: string): { runtime: string; devRuntime: string } {
  const match = ilhaMainUrl.match(/\/ilha@([^/]+)\//);
  const ver = match?.[1] ?? "latest";
  const base = `${PREVIEW_ESM_ORIGIN}/ilha@${ver}/${PREVIEW_ESM_TARGET}`;
  return {
    runtime: `${base}/jsx-runtime.mjs`,
    devRuntime: `${base}/jsx-dev-runtime.mjs`,
  };
}

/** Read effect version from ilha's esm.sh bundle so peers share the same module. */
export function effectBaseUrlFromIlhaBundle(ilhaBundleSource: string): string {
  const ver =
    ilhaBundleSource.match(/\/effect@([^/"?]+)/)?.[1]?.replace(/^\^/, "") ?? "4.0.0-rc.112";
  return `${PREVIEW_ESM_ORIGIN}/effect@${ver}/${PREVIEW_ESM_TARGET}`;
}

/** @ilha/store still uses alien-signals; pin the same version from its bundle. */
export function alienSignalsUrlFromStoreBundle(storeBundleSource: string): string {
  const ver =
    storeBundleSource.match(/alien-signals@([^?"']+)/)?.[1]?.replace(/^\^/, "") ?? "3.2.1";
  return `${PREVIEW_ESM_ORIGIN}/alien-signals@${ver}/${PREVIEW_ESM_TARGET}/alien-signals.mjs`;
}

export function buildPreviewImportMapFromPeers(
  ilhaUrl: string,
  ilhaVersion: string,
  ilhaBundleSource = "",
  storeUrls?: { storeUrl: string; formUrl: string; bundleSource?: string },
): Record<string, string> {
  const jsx = ilhaJsxUrls(ilhaUrl);
  const effectBase = effectBaseUrlFromIlhaBundle(ilhaBundleSource);
  const imports: Record<string, string> = {
    ilha: ilhaUrl,
    "ilha/jsx-runtime": jsx.runtime,
    "ilha/jsx-dev-runtime": jsx.devRuntime,
    "react/jsx-runtime": jsx.runtime,
    "react/jsx-dev-runtime": jsx.devRuntime,
    effect: `${effectBase}/effect.mjs`,
    "effect/": `${effectBase}/`,
    "alien-signals": alienSignalsUrlFromStoreBundle(storeUrls?.bundleSource ?? ""),
  };
  if (storeUrls) {
    imports["@ilha/store"] = storeUrls.storeUrl;
    imports["@ilha/store/form"] = storeUrls.formUrl;
  }

  for (const spec of PREVIEW_STANDALONE_PACKAGES) {
    imports[spec.name] = standaloneEntry(spec.pkg ?? spec.name, spec.sharedDeps, ilhaVersion);
  }
  return imports;
}

export function assertPreviewImportMapConsistent(map: Record<string, string>): void {
  for (const key of PREVIEW_SHARED_RUNTIME_KEYS) {
    const url = map[key];
    if (!url) continue;
    if (url.includes("standalone")) {
      throw new Error(`preview import map: "${key}" must not use ?standalone`);
    }
    if (!/\/[^/]+@[^/]+\//.test(url)) {
      throw new Error(`preview import map: "${key}" must be a versioned esm.sh .mjs URL`);
    }
  }

  for (const storeKey of ["@ilha/store", "@ilha/store/form"] as const) {
    const storeEntryUrl = map[storeKey];
    if (!storeEntryUrl || storeEntryUrl.includes("standalone")) {
      throw new Error(
        `preview import map: "${storeKey}" must be a versioned .mjs URL (not ?standalone)`,
      );
    }
  }
  if (!map["effect"]?.includes("effect@")) {
    throw new Error('preview import map: "effect" must be a versioned esm.sh URL');
  }
  if (!map["alien-signals"]?.includes("alien-signals@")) {
    throw new Error('preview import map: "alien-signals" must be a versioned esm.sh URL');
  }

  for (const spec of PREVIEW_STANDALONE_PACKAGES) {
    const entry = map[spec.name];
    if (!entry?.includes("standalone")) {
      throw new Error(`preview import map: "${spec.name}" must be ?standalone`);
    }
    if (!entry.includes("deps=")) {
      throw new Error(`preview import map: "${spec.name}" must include deps=`);
    }
    for (const dep of spec.sharedDeps) {
      if (!map[dep]) {
        throw new Error(`preview import map: "${spec.name}" needs "${dep}" in map`);
      }
      if (dep === "ilha" && !/deps=[^&]*ilha@/.test(entry)) {
        throw new Error(`preview import map: "${spec.name}" must pin deps ilha@<version>`);
      }
      if (dep !== "ilha" && !entry.includes(dep)) {
        throw new Error(`preview import map: "${spec.name}" deps must include ${dep}`);
      }
    }
  }
}

let resolvedMap: Record<string, string> | null = null;
let resolvePromise: Promise<Record<string, string>> | null = null;

/** Resolve latest-compatible singleton URLs from esm.sh (cached per page load). */
export async function resolvePreviewImportMap(): Promise<Record<string, string>> {
  if (resolvedMap) return resolvedMap;
  if (!resolvePromise) {
    resolvePromise = (async () => {
      const [{ version: ilhaVersion, url: ilhaUrl }, store] = await Promise.all([
        resolveIlhaSingletonFromEsm(),
        resolveStoreFromEsm(),
      ]);
      const ilhaRes = await fetch(ilhaUrl);
      if (!ilhaRes.ok) throw new Error(`preview CDN: esm.sh ilha bundle → ${ilhaRes.status}`);
      const ilhaBundleSource = await ilhaRes.text();
      const storeRes = await fetch(store.storeUrl);
      const storeBundleSource = storeRes.ok ? await storeRes.text() : "";
      const map = buildPreviewImportMapFromPeers(ilhaUrl, ilhaVersion, ilhaBundleSource, {
        storeUrl: store.storeUrl,
        formUrl: store.formUrl,
        bundleSource: storeBundleSource,
      });
      assertPreviewImportMapConsistent(map);
      resolvedMap = map;
      return map;
    })();
  }
  return resolvePromise;
}

export function resetPreviewImportMapCache(): void {
  resolvedMap = null;
  resolvePromise = null;
}
