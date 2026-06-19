/** Preview iframe import map: one ilha + one sonner via esm.sh (resolved at runtime). */

export const PREVIEW_ESM_ORIGIN = "https://esm.sh";
export const PREVIEW_ESM_TARGET = "es2022";
export const PREVIEW_TRANSFORM_URL = `${PREVIEW_ESM_ORIGIN}/transform`;

export const PREVIEW_SHARED_RUNTIME_KEYS = ["ilha", "sonner"] as const;
export type PreviewSharedRuntimeKey = (typeof PREVIEW_SHARED_RUNTIME_KEYS)[number];

export type PreviewStandalonePackage = {
  name: string;
  pkg?: string;
  sharedDeps: PreviewSharedRuntimeKey[];
};

export const PREVIEW_STANDALONE_PACKAGES: PreviewStandalonePackage[] = [
  { name: "areia", sharedDeps: ["ilha", "sonner"] },
  { name: "quando", sharedDeps: ["ilha"] },
  { name: "@ilha/store", sharedDeps: ["ilha"] },
];

/** Stub used to resolve sonner (and verify areia) peer URLs. */
const SONNER_PEER_STUB_PACKAGE = "areia";

const PEER_IMPORT_RE = /import\s+"\/([^"@/]+)@([^/]+)\/([^"]+)"/g;
const ILHA_VER_RE = /ilha@([0-9]+\.[0-9]+\.[0-9]+)/;

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

/** Parse `import "/pkg@ver/path"` lines from an esm.sh standalone stub. */
export function parseEsmShPeerImports(stubSource: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const m of stubSource.matchAll(PEER_IMPORT_RE)) {
    const pkg = m[1]!;
    const ver = m[2]!;
    const rest = m[3]!;
    out.set(pkg, `${PREVIEW_ESM_ORIGIN}/${pkg}@${ver}/${rest}`);
  }
  return out;
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

export function buildPreviewImportMapFromPeers(
  ilhaUrl: string,
  peerUrls: Map<string, string>,
  ilhaVersion: string,
): Record<string, string> {
  const jsx = ilhaJsxUrls(ilhaUrl);
  const imports: Record<string, string> = {
    ilha: ilhaUrl,
    "ilha/jsx-runtime": jsx.runtime,
    "ilha/jsx-dev-runtime": jsx.devRuntime,
    "react/jsx-runtime": jsx.runtime,
    "react/jsx-dev-runtime": jsx.devRuntime,
  };
  const sonner = peerUrls.get("sonner");
  if (sonner) imports.sonner = sonner;

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
      const { version: ilhaVersion, url: ilhaUrl } = await resolveIlhaSingletonFromEsm();
      const anchor = PREVIEW_STANDALONE_PACKAGES.find((s) => s.name === SONNER_PEER_STUB_PACKAGE)!;
      const probeUrl = standaloneEntry(anchor.pkg ?? anchor.name, anchor.sharedDeps, ilhaVersion);
      const res = await fetch(probeUrl);
      if (!res.ok) throw new Error(`preview CDN: esm.sh ${probeUrl} → ${res.status}`);
      const stub = await res.text();
      const peers = parseEsmShPeerImports(stub);
      peers.set("ilha", ilhaUrl);
      const map = buildPreviewImportMapFromPeers(ilhaUrl, peers, ilhaVersion);
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
