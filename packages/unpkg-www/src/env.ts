export interface Env {
  APP_ORIGIN: string;
  ASSETS_ORIGIN: string;
  DEV: boolean;
  FILES_ORIGIN: string;
  MODE: "development" | "production" | "staging" | "test";
  ORIGIN: string;
}
