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
  // Shield version pinning (optional). The SBOM API publishes the ruleset
  // to Workers KV; the worker reads it from this binding and never
  // contacts the API. When unset, the worker behaves exactly as if
  // shield.ts did not exist. Bound in wrangler.json (`kv_namespaces`).
  SHIELD_RULES?: ShieldKV;
}
