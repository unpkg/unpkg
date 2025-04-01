export interface Env {
  APP_ORIGIN: string;
  ASSETS_ORIGIN: string;
  DEV: boolean;
  MODE: "development" | "production" | "staging" | "test";
}

const envs: Record<Env["MODE"], Env> = {
  development: {
    APP_ORIGIN: "http://localhost:3001",
    ASSETS_ORIGIN: "http://localhost:8000",
    DEV: true,
    MODE: "development",
  },
  production: {
    APP_ORIGIN: "https://app.unpkg.com",
    ASSETS_ORIGIN: "",
    DEV: false,
    MODE: "production",
  },
  staging: {
    APP_ORIGIN: "https://app.unpkg.dev",
    ASSETS_ORIGIN: "",
    DEV: false,
    MODE: "staging",
  },
  test: {
    APP_ORIGIN: "https://app.unpkg.com",
    ASSETS_ORIGIN: "",
    DEV: false,
    MODE: "test",
  },
};

let mode = (process.env.NODE_ENV ?? "development") as Env["MODE"];
if (!(mode in envs)) {
  throw new Error(`Invalid NODE_ENV: ${mode}`);
}

export const env = envs[mode];
