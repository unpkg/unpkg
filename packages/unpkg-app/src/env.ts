export interface Env {
  ASSETS_ORIGIN: string;
  DEV: boolean;
  FILES_ORIGIN: string;
  MODE: "development" | "production" | "staging" | "test";
  ORIGIN: string;
  WWW_ORIGIN: string;
}
