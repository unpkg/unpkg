/**
 * Cache generations: selective eviction for the Worker's Cache API layers.
 *
 * Zone purge operations (by URL, prefix, host, or Cache-Tag) do not evict
 * entries stored through the Workers Cache API — verified experimentally
 * on staging. The only selective mechanism available for those layers is
 * to change the cache keys a version resolves to, so entries written
 * under older keys are orphaned and the next request refetches.
 *
 * State lives in a dedicated Workers KV namespace (binding
 * CACHE_GENERATIONS, key `cache-generations:v1`) owned by unpkg ops and
 * fully independent of Shield: either system works with the other unset.
 * The document contains ONLY versions an operator has explicitly evicted:
 *
 *   {
 *     "schema": 1,
 *     "v": 7,
 *     "generations": {
 *       "lodash@4.17.20": { "gen": 1, "expires_at": "2027-11-27T00:00:00Z" }
 *     }
 *   }
 *
 * A generation applies from publication until its expiry (400 days in
 * the evict script — beyond the 1-year maximum lifetime of the cache
 * entries it displaces, so expiry cannot resurrect them). Expired
 * entries are ignored here and pruned by the writer.
 *
 * Loading mirrors the Shield rules reader: isolate memory, backed by a
 * Cache API blob, refreshed from KV on a jittered soft TTL. Requests
 * never read KV directly; they consult the in-memory map. Every failure
 * is fail-open to generation 0, which reproduces today's cache keys
 * byte-for-byte.
 *
 * The binding is optional. When unset, this module behaves as if it did
 * not exist.
 */

export interface CacheGenerationsKV {
  get(key: string, type: "text"): Promise<string | null>;
}

export interface CacheGenerationsDeps {
  kv?: CacheGenerationsKV | null;
  cache?: Cache;
  now?: () => number;
}

export interface CacheGenerationEntry {
  generation: number;
  expiresAtMs: number;
}

export interface ParsedGenerations {
  generations: Map<string, CacheGenerationEntry>;
  hash: string;
  version: number | null;
}

const GENERATIONS_KV_KEY = "cache-generations:v1";
const GENERATIONS_CACHE_KEY = "https://unpkg.internal/cache-generations";
const SOFT_TTL_MS = 60_000;
const HARD_TTL_MS = 3_600_000;
const REFRESH_JITTER_MS = 10_000;

interface GenerationsState {
  generations: Map<string, CacheGenerationEntry>;
  hash: string;
  version: number | null;
  fetchedAt: number;
}

let generationsState: GenerationsState | null = null;
let lastRefreshAttempt = 0;
let refreshInFlight: Promise<void> | null = null;

const requestGenerations = new WeakMap<Request, number>();

/** Record the generation the Worker resolved for this request (handler hand-off). */
export function setRequestCacheGeneration(request: Request, generation: number): void {
  if (generation > 0) requestGenerations.set(request, generation);
}

/** Generation recorded by the Worker for this request (0 when none). */
export function getRequestCacheGeneration(request: Request): number {
  return requestGenerations.get(request) ?? 0;
}

export function __resetCacheGenerationsForTests(): void {
  generationsState = null;
  lastRefreshAttempt = 0;
  refreshInFlight = null;
}

function fnv1a(input: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function parseEntry(value: unknown): CacheGenerationEntry | null {
  let generation: unknown;
  let expiresAtMs: number;
  if (Array.isArray(value)) {
    // Compact form: [generation, expiresAtEpochSeconds]
    generation = value[0];
    expiresAtMs = typeof value[1] === "number" ? value[1] * 1000 : NaN;
  } else if (value != null && typeof value === "object") {
    const entry = value as Record<string, unknown>;
    generation = entry["gen"];
    const rawExpiry = entry["expires_at"];
    expiresAtMs =
      typeof rawExpiry === "number" ? rawExpiry * 1000 : typeof rawExpiry === "string" ? Date.parse(rawExpiry) : NaN;
  } else {
    return null;
  }
  if (typeof generation !== "number" || !Number.isInteger(generation) || generation <= 0) return null;
  if (!Number.isFinite(expiresAtMs)) return null;
  return { generation, expiresAtMs };
}

export function parseGenerationsPayload(text: string): ParsedGenerations | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  if (parsed == null || typeof parsed !== "object") return null;
  const payload = parsed as Record<string, unknown>;
  if (payload["schema"] !== 1) return null;

  const version = typeof payload["v"] === "number" ? payload["v"] : null;
  const generations = new Map<string, CacheGenerationEntry>();
  const rawMap = payload["generations"];
  // A missing or wrong-typed generations map is a malformed document,
  // not an empty one: accepting it would silently clear every eviction.
  if (rawMap == null || typeof rawMap !== "object" || Array.isArray(rawMap)) return null;
  for (const [key, value] of Object.entries(rawMap as Record<string, unknown>)) {
    const entry = parseEntry(value);
    if (entry) generations.set(key.toLowerCase(), entry);
  }

  return { generations, hash: fnv1a(JSON.stringify([...generations.entries()].sort())), version };
}

function generationsResponse(state: GenerationsState): Response {
  return new Response(
    JSON.stringify({
      schema: 1,
      v: state.version,
      generations: Object.fromEntries(
        [...state.generations.entries()].map(([key, entry]) => [
          key,
          { gen: entry.generation, expires_at: new Date(entry.expiresAtMs).toISOString() },
        ])
      ),
    }),
    // Bounded by the hard TTL: the blob is a warm-start aid, never a
    // source that can outlive the isolate refresh cycle by a year.
    { headers: { "Cache-Control": "public, max-age=3600" } }
  );
}

function resolveDeps(
  env: { CACHE_GENERATIONS?: CacheGenerationsKV },
  deps?: CacheGenerationsDeps
): Required<CacheGenerationsDeps> {
  return {
    kv: deps?.kv !== undefined ? deps.kv : (env.CACHE_GENERATIONS ?? null),
    cache: deps?.cache ?? (typeof caches !== "undefined" ? caches.default : (null as unknown as Cache)),
    now: deps?.now ?? (() => Date.now()),
  };
}

async function refreshGenerations(
  deps: Required<CacheGenerationsDeps>,
  cacheRequest: Request,
  context?: ExecutionContext
): Promise<void> {
  if (!deps.kv) return;
  if (refreshInFlight) return refreshInFlight;
  lastRefreshAttempt = deps.now();
  const run = (async () => {
    try {
      const text = await deps.kv!.get(GENERATIONS_KV_KEY, "text");
      if (text != null) {
        const parsed = parseGenerationsPayload(text);
        if (parsed) {
          const current = generationsState;
          if (current && parsed.version != null && current.version != null && parsed.version < current.version) {
            // Stale read: keep the newer in-memory document.
          } else if (current && parsed.hash === current.hash) {
            current.fetchedAt = deps.now();
          } else {
            generationsState = { ...parsed, fetchedAt: deps.now() };
            if (deps.cache) {
              const put = deps.cache.put(cacheRequest, generationsResponse(generationsState)).catch(() => {});
              if (context) context.waitUntil(put);
              else await put;
            }
          }
        }
      }
    } catch (error) {
      console.error(error);
    }
  })();
  refreshInFlight = run;
  try {
    if (context) context.waitUntil(run);
    await run;
  } finally {
    if (refreshInFlight === run) refreshInFlight = null;
  }
}

function scheduleRefresh(
  deps: Required<CacheGenerationsDeps>,
  cacheRequest: Request,
  context?: ExecutionContext
): void {
  const threshold = SOFT_TTL_MS + Math.random() * REFRESH_JITTER_MS;
  if (deps.now() - lastRefreshAttempt < threshold) return;
  void refreshGenerations(deps, cacheRequest, context).catch(() => {});
}

/**
 * Load the current generations state (memory, then Cache API blob, then
 * KV). Fail-open: any problem yields whatever is in memory, or empty.
 */
export async function loadCacheGenerations(
  env: { CACHE_GENERATIONS?: CacheGenerationsKV },
  context?: ExecutionContext,
  deps?: CacheGenerationsDeps
): Promise<Map<string, CacheGenerationEntry>> {
  const resolved = resolveDeps(env, deps);
  if (!resolved.kv) return generationsState?.generations ?? new Map();
  const now = resolved.now();
  const cacheRequest = new Request(GENERATIONS_CACHE_KEY);

  if (generationsState && now - generationsState.fetchedAt < HARD_TTL_MS) {
    if (now - generationsState.fetchedAt > SOFT_TTL_MS) {
      scheduleRefresh(resolved, cacheRequest, context);
    }
    return generationsState.generations;
  }

  if (resolved.cache) {
    try {
      const cached = await resolved.cache.match(cacheRequest);
      if (cached) {
        const parsed = parseGenerationsPayload(await cached.text());
        if (parsed) {
          // Never regress in-memory state to an older document version:
          // a stale DC blob must not resurrect evicted entries.
          if (
            generationsState &&
            parsed.version != null &&
            generationsState.version != null &&
            parsed.version < generationsState.version
          ) {
            scheduleRefresh(resolved, cacheRequest, context);
            return generationsState.generations;
          }
          generationsState = { ...parsed, fetchedAt: now };
          scheduleRefresh(resolved, cacheRequest, context);
          return generationsState.generations;
        }
      }
    } catch (error) {
      console.error(error);
    }
  }

  // Cold start in this colo: return what we have (possibly empty) and
  // warm in the background, exactly like the Shield rules reader.
  scheduleRefresh(resolved, cacheRequest, context);
  return generationsState?.generations ?? new Map();
}

/**
 * Current generation for one exact package version (0 = no eviction).
 * Expired entries count as 0 even before the writer prunes them.
 */
export async function getCacheGeneration(
  env: { CACHE_GENERATIONS?: CacheGenerationsKV },
  context: ExecutionContext | undefined,
  packageName: string,
  version: string,
  deps?: CacheGenerationsDeps
): Promise<number> {
  try {
    const generations = await loadCacheGenerations(env, context, deps);
    const entry = generations.get(`${packageName.toLowerCase()}@${version}`);
    if (!entry) return 0;
    const now = (deps?.now ?? (() => Date.now()))();
    return entry.expiresAtMs > now ? entry.generation : 0;
  } catch (error) {
    console.error(error);
    return 0;
  }
}
