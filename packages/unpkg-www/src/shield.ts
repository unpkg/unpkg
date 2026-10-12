import type { Env } from "./env.ts";

/**
 * Shield version pinning for unpkg-www.
 *
 * This module is the TypeScript half of the Shield<->unpkg edge contract.
 * The Python half lives in the SBOM API's `app/services/edge_matching.py`.
 * Both implementations MUST agree on every case in
 * `test/fixtures/edge_match_conformance.json` — that fixture file is the
 * executable contract. Contract rules (do not change without updating the
 * fixtures AND both implementations):
 *
 * 1. Package names compare case-insensitively (lowercased on both sides).
 * 2. Versions match EXACTLY — no semver ranges at the edge. Range/tag URLs
 *    resolve to exact versions via short-lived redirects before the swap.
 *    (Deliberate: edge matching stays dumb and predictable. The API
 *    expands any ranges to exact `from` versions server-side.)
 * 3. Domains: exact match or parent-domain suffix match
 *    (`app.example.com` matches `example.com`, but `evilexample.com`
 *    does not). `"*"` matches everything, as does an absent `domains`
 *    list (forward-compatible with compact future feed shapes).
 * 4. `Referer` is primary; the `Origin` header is the fallback. Neither
 *    present -> no match (fail-open).
 * 5. Actions: `pin` (default when absent) rewrites to `to`; `block`
 *    serves a static 403 stub. Unknown actions are IGNORED (fail-open),
 *    so the feed can introduce new actions without breaking older
 *    workers. Unknown fields are likewise ignored.
 * 6. Overlapping rules match first-wins: servers order
 *    specific-before-general.
 *
 * Failure philosophy (stated in both repos):
 *     The edge degrades to plain unpkg; the API degrades to human review.
 *
 * Correctness notes for the rules cache:
 * - Refresh is time-based (jittered soft TTL), out-of-band via
 *   `context.waitUntil`: Shield API latency can never add to response time.
 * - In-memory replacement is always safe because of the in-flight guard: a
 *   fetch that completes did so after the previous accept, so its server
 *   state is newer or equal. The version/hash comparison only skips
 *   redundant rebuilds — it is an optimization, not a correctness gate.
 * - TTLs use local fetch time only. Server timestamps are never compared
 *   against the worker clock for correctness.
 * - The Cache API put is guarded by `v` so a slow fetch cannot regress a
 *   newer DC-wide entry written by a fresher isolate.
 * - Payloads with a newer `schema` than supported are ignored entirely,
 *   so an API deploy can never confuse an older worker.
 * - Origin fetches are gated to ~1/soft-TTL/isolate even when the API is
 *   failing, so a brownout can never turn request rate into origin load.
 *
 * Deliberate non-goals: enforcement events are NOT reported back to the
 * API (no beacons). The worker is pure local request rewriting; the only
 * outbound call it ever makes is the rules fetch. Firing visibility comes
 * from feed-change logs plus CDN request logs, joined data-platform-side.
 */

export type ShieldAction = "pin" | "block";

export interface ShieldRule {
  action: ShieldAction;
  from: Set<string>;
  to: string | null;
  domains: Set<string>;
  /**
   * Opaque API-provided references (remediation ids). Inert at runtime —
   * matching never reads them — but kept parsed so the rule shape stays
   * uniform across the feed, the worker, and the API-side simulator.
   */
  refs?: string[];
}

export type ShieldRulesMap = Map<string, ShieldRule[]>;

export type ShieldDecision =
  | { type: "none" }
  | { type: "rewrite"; location: string; rule: ShieldRule }
  | { type: "block"; rule: ShieldRule; pkg: string; version: string };

const RULES_CACHE_KEY = new Request("https://shield-internal/rules");
const RULES_PATH = "/edge/rules";
const MAX_SUPPORTED_SCHEMA = 1;
// Jittered per isolate so DCs don't refresh in lockstep (thundering herd).
const SOFT_TTL_MIN_MS = 25_000;
const SOFT_TTL_MAX_MS = 35_000;
const HARD_TTL_MS = 3_600_000;

export interface ShieldFetch {
  (url: string, init?: { headers?: Record<string, string> }): Promise<Response>;
}

export interface ShieldDeps {
  cache: Cache;
  fetch: ShieldFetch;
}

function defaultDeps(): ShieldDeps {
  // @ts-expect-error - `caches.default` is missing in @cloudflare/workers-types
  const cache = caches.default as Cache;
  const fetch: ShieldFetch = (url, init) => globalThis.fetch(url, init);
  return { cache, fetch };
}

let rulesMap: ShieldRulesMap | null = null;
let rulesVersion = 0;
let rulesHash = "";
let rulesFetchedAt = 0;
let lastRefreshAttempt = 0;
let softTtlMs = SOFT_TTL_MIN_MS + Math.random() * (SOFT_TTL_MAX_MS - SOFT_TTL_MIN_MS);
let refreshInFlight: Promise<void> | null = null;

/** Test-only: reset module state between cases. */
export function __resetShieldStateForTests(): void {
  rulesMap = null;
  rulesVersion = 0;
  rulesHash = "";
  rulesFetchedAt = 0;
  lastRefreshAttempt = 0;
  softTtlMs = SOFT_TTL_MIN_MS;
  refreshInFlight = null;
}

/** Test-only: force the cached rules to look stale. */
export function __ageShieldRulesForTests(ageMs: number): void {
  rulesFetchedAt = Date.now() - ageMs;
  lastRefreshAttempt = Date.now() - ageMs;
}

function scheduleRefresh(env: Env, context: ExecutionContext, deps: ShieldDeps): void {
  // At most one origin fetch per soft TTL per isolate — including when the
  // origin is failing. Without this gate, every request past a failed
  // refresh would trigger another attempt, so an API brownout would turn
  // the fleet's request rate into origin load (a self-inflicted DDoS).
  // With it, total origin load is bounded by (live isolates / soft TTL)
  // by construction, in success and failure alike.
  const now = Date.now();
  if (now - lastRefreshAttempt < softTtlMs) return;
  lastRefreshAttempt = now;
  context.waitUntil(refreshRules(env, deps));
}

function fnv1a(input: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16);
}

interface RulesPayload {
  schema?: unknown;
  v?: unknown;
  rules?: unknown;
}

export function buildRulesMap(rules: unknown): { map: ShieldRulesMap; hash: string } {
  const map: ShieldRulesMap = new Map();
  if (!Array.isArray(rules)) return { map, hash: fnv1a("[]") };
  for (const rule of rules) {
    if (rule == null || typeof rule !== "object") continue;
    const entry = rule as Record<string, unknown>;
    // Unknown fields are ignored so the feed can evolve (schema versioning)
    // without breaking older workers.
    if (typeof entry["pkg"] !== "string") continue;
    const action = entry["action"] == null ? "pin" : entry["action"];
    if (action !== "pin" && action !== "block") continue; // unknown future action: ignore
    if (action === "pin" && typeof entry["to"] !== "string") continue; // malformed pin: ignore
    const pkg = entry["pkg"].toLowerCase();
    const from = Array.isArray(entry["from"]) ? entry["from"].filter((v): v is string => typeof v === "string") : [];
    // Absent domains list means global (same as ["*"]).
    const domains = Array.isArray(entry["domains"])
      ? entry["domains"].filter((d): d is string => typeof d === "string").map((d) => d.toLowerCase())
      : ["*"];
    const shieldRule: ShieldRule = {
      action,
      from: new Set(from),
      to: typeof entry["to"] === "string" ? entry["to"] : null,
      domains: new Set(domains),
    };
    if (Array.isArray(entry["refs"])) {
      const refs = entry["refs"].filter((r): r is string => typeof r === "string");
      if (refs.length) shieldRule.refs = refs;
    }
    const existing = map.get(pkg) ?? [];
    existing.push(shieldRule);
    map.set(pkg, existing);
  }
  return { map, hash: fnv1a(JSON.stringify(rules)) };
}

export async function getShieldRules(
  env: Env,
  context: ExecutionContext,
  deps: ShieldDeps = defaultDeps()
): Promise<ShieldRulesMap | null> {
  if (!env.SHIELD_API_ORIGIN || !env.SHIELD_API_KEY) return null;

  const now = Date.now();
  if (rulesMap && now - rulesFetchedAt < HARD_TTL_MS) {
    if (now - rulesFetchedAt > softTtlMs) {
      scheduleRefresh(env, context, deps);
    }
    return rulesMap;
  }

  // Memory empty or hard-expired: try the Cache API (populated by other
  // isolates in this DC), then always revalidate in the background since
  // this isolate's view is cold.
  try {
    const cached = await deps.cache.match(RULES_CACHE_KEY);
    if (cached) {
      const data = (await cached.json()) as RulesPayload;
      if (typeof data.schema === "number" && data.schema > MAX_SUPPORTED_SCHEMA) {
        scheduleRefresh(env, context, deps);
        return null;
      }
      const built = buildRulesMap(data.rules ?? []);
      rulesMap = built.map;
      rulesVersion = typeof data.v === "number" ? data.v : 0;
      rulesHash = built.hash;
      rulesFetchedAt = now;
      scheduleRefresh(env, context, deps);
      return rulesMap;
    }
  } catch {
    // Fall through to background refresh; a corrupt cache entry must never
    // break requests.
  }

  // DC cold start: skip Shield for this request (fail-open), warm in background.
  scheduleRefresh(env, context, deps);
  return null;
}

export async function refreshRules(env: Env, deps: ShieldDeps = defaultDeps()): Promise<void> {
  // In-flight guard: concurrent refreshes collapse into one. This also
  // orders accepted fetches (each completes after the previous accept),
  // which is what makes in-memory replacement unconditionally safe.
  if (refreshInFlight) return refreshInFlight;
  refreshInFlight = doRefresh(env, deps).finally(() => {
    refreshInFlight = null;
  });
  return refreshInFlight;
}

async function doRefresh(env: Env, deps: ShieldDeps): Promise<void> {
  try {
    const resp = await deps.fetch(`${env.SHIELD_API_ORIGIN}${RULES_PATH}`, {
      headers: { Authorization: `Bearer ${env.SHIELD_API_KEY}` },
    });
    if (!resp.ok) return;
    const data = (await resp.json()) as RulesPayload;
    if (typeof data.schema === "number" && data.schema > MAX_SUPPORTED_SCHEMA) return;
    const built = buildRulesMap(data.rules ?? []);
    const version = typeof data.v === "number" ? data.v : 0;
    // Always advance the fetch clock on success: this sets this isolate's
    // next refresh ~one soft TTL out. The map rebuild is skipped when the
    // content is identical (pure optimization).
    rulesFetchedAt = Date.now();
    if (built.hash !== rulesHash) {
      rulesMap = built.map;
      rulesHash = built.hash;
      rulesVersion = version;
    } else if (version > rulesVersion) {
      rulesVersion = version;
    }
    // Put guard: never let a slow fetch regress a newer DC-wide entry.
    try {
      const cached = await deps.cache.match(RULES_CACHE_KEY);
      if (cached) {
        const cachedData = (await cached.json()) as RulesPayload;
        if (typeof cachedData.v === "number" && cachedData.v > version) return;
      }
      await deps.cache.put(
        RULES_CACHE_KEY,
        new Response(JSON.stringify(data), {
          headers: { "Cache-Control": `max-age=${HARD_TTL_MS / 1000}` },
        })
      );
    } catch {
      // Cache write failure must never break requests.
    }
  } catch (error) {
    console.error("Shield rules refresh failed:", error);
  }
}

const PKG_VERSION_RE = /^\/((?:@[^/]+\/)?[^/@]+)@([^/]+)/;

/** Fast precheck so non-package paths (/, /_health, /run) skip Shield entirely. */
export function isPackagePath(pathname: string): boolean {
  return PKG_VERSION_RE.test(pathname);
}

export function normalizeHost(value: string | null): string | null {
  if (!value) return null;
  try {
    const host = new URL(value.trim()).hostname;
    if (!host) return null;
    return host.toLowerCase().replace(/\.$/, "");
  } catch {
    return null;
  }
}

export function domainMatches(ruleDomain: string, host: string): boolean {
  const normalized = ruleDomain.toLowerCase().replace(/\.$/, "");
  if (normalized === "*") return true;
  if (host === normalized) return true;
  return host.endsWith(`.${normalized}`);
}

/**
 * Match one request against the rules. Pin rules return the rewritten
 * path+search (only the version token changes; the package segment keeps
 * its original case). Block rules return the matched rule so the caller
 * can serve the static block stub. Overlapping rules match first-wins.
 */
export function evaluateShieldRequest(
  url: URL,
  request: Request,
  rules: ShieldRulesMap
): ShieldDecision {
  const match = url.pathname.match(PKG_VERSION_RE);
  if (!match) return { type: "none" };

  const rawPackage = match[1];
  const version = match[2];

  const packageRules = rules.get(rawPackage.toLowerCase());
  if (!packageRules) return { type: "none" };

  const rule = packageRules.find((r) => r.from.has(version));
  if (!rule) return { type: "none" };

  const host = normalizeHost(request.headers.get("Referer")) ?? normalizeHost(request.headers.get("Origin"));
  if (!host) return { type: "none" };

  let covered = false;
  for (const domain of rule.domains) {
    if (domainMatches(domain, host)) {
      covered = true;
      break;
    }
  }
  if (!covered) return { type: "none" };

  if (rule.action === "block" || rule.to == null) {
    return { type: "block", rule, pkg: rawPackage.toLowerCase(), version };
  }

  // match[0] is the `/pkg@version` prefix; splice in the safe version.
  const prefix = match[0].slice(0, -version.length) + rule.to;
  return {
    type: "rewrite",
    location: prefix + url.pathname.slice(match[0].length) + url.search,
    rule,
  };
}

/**
 * Static block stub. Deliberately static (only the request-derived
 * package@version is reflected, as text/plain): there is no data-driven
 * body to inject into, and nothing to tune per incident. `no-store` so
 * browsers never cache the block — rule removal unblocks immediately.
 * (The worker never edge-caches non-200s either, so no purge is needed.)
 */
export function buildBlockResponse(packageName: string, version: string): Response {
  return new Response(
    `Blocked by Shield: ${packageName}@${version} is not served due to a security advisory.\n`,
    {
      status: 403,
      headers: {
        "Cache-Control": "no-store",
        "Content-Type": "text/plain; charset=utf-8",
        "Access-Control-Allow-Origin": "*",
        "Cross-Origin-Resource-Policy": "cross-origin",
      },
    }
  );
}
