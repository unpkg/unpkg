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
}
