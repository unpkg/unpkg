export interface Env {
  APP_ORIGIN: string;
  ASSETS_ORIGIN: string;
  DEV: boolean;
  ESM_ORIGIN: string;
  FILES_ORIGIN: string;
  MODE: "development" | "production" | "staging" | "test";
  ORIGIN: string;
  // Shield version pinning (optional). When either is unset the worker
  // behaves exactly as if shield.ts did not exist. SHIELD_API_KEY is a
  // secret (`wrangler secret put`) and MUST never appear in wrangler.json;
  // production/staging SHIELD_API_ORIGIN values are set at deploy time.
  SHIELD_API_ORIGIN?: string;
  SHIELD_API_KEY?: string;
}
