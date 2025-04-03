export interface Env {
  APP_ORIGIN: string;
  ASSETS_ORIGIN: string;
  DEBUG: boolean;
  DEV: boolean;
  MODE: "development" | "production" | "staging" | "test";
  WWW_ORIGIN: string;
}

const envs: Record<Env["MODE"], Env> = {
  development: {
    APP_ORIGIN: "http://localhost:3001",
    ASSETS_ORIGIN: "http://localhost:8001",
    DEBUG: true,
    DEV: true,
    MODE: "development",
    WWW_ORIGIN: "http://localhost:3000",
  },
  production: {
    APP_ORIGIN: "https://app.unpkg.com",
    ASSETS_ORIGIN: "",
    DEBUG: !!(process.env.DEBUG ?? false),
    DEV: false,
    MODE: "production",
    WWW_ORIGIN: "https://unpkg.com",
  },
  staging: {
    APP_ORIGIN: "https://app.unpkg.dev",
    ASSETS_ORIGIN: "",
    DEBUG: !!(process.env.DEBUG ?? false),
    DEV: false,
    MODE: "staging",
    WWW_ORIGIN: "https://unpkg.dev",
  },
  test: {
    APP_ORIGIN: "https://app.unpkg.com",
    ASSETS_ORIGIN: "",
    DEBUG: false,
    DEV: false,
    MODE: "test",
    WWW_ORIGIN: "https://unpkg.com",
  },
};

let mode = (process.env.MODE ?? "development") as Env["MODE"];
if (!(mode in envs)) {
  throw new Error(`Invalid MODE: ${mode}`);
}

export const env = envs[mode];
