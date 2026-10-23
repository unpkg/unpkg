/** Minimal structural surface of the SHIELD_RULES KVNamespace binding. */
export interface ShieldKV {
  get(key: string, type: "text"): Promise<string | null>;
}

export interface Env {
  APP_ORIGIN: string;
  ASSETS_ORIGIN: string;
  DEV: boolean;
  ESM_ORIGIN: string;
  FILES_ORIGIN: string;
  MODE: "development" | "production" | "staging" | "test";
  ORIGIN: string;
  // GA4 measurement ID. Set in wrangler.json production vars only; dev and
  // staging omit it so non-production traffic stays out of analytics.
  GA_MEASUREMENT_ID?: string;
  // Shield version pinning (optional). The SBOM API publishes the ruleset
  // to Workers KV; the worker reads it from this binding and never
  // contacts the API. When unset, the worker behaves exactly as if
  // shield.ts did not exist. Bound in wrangler.json (`kv_namespaces`).
  SHIELD_RULES?: ShieldKV;
  // Cache generations (optional, independent of Shield). unpkg ops
  // publishes per-version cache generations to this Workers KV namespace;
  // the worker reads it from this binding. When unset, every version is
  // generation 0 and cache keys are exactly as before.
  // Bound in wrangler.json (`kv_namespaces`).
  CACHE_GENERATIONS?: ShieldKV;
}
