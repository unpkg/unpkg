export interface Env {
  APP_ORIGIN: string;
  ASSETS_ORIGIN: string;
  DEV: boolean;
  HOST: string;
  NAME: "development" | "production" | "staging" | "test";
  WWW_ORIGIN: string;
}

const envs: Record<string, Env> = {
  development: {
    APP_ORIGIN: "http://localhost:3001",
    ASSETS_ORIGIN: "http://localhost:8001",
    DEV: true,
    HOST: "localhost:3001",
    NAME: "development",
    WWW_ORIGIN: "http://localhost:3000",
  },
  production: {
    APP_ORIGIN: "https://app.unpkg.com",
    ASSETS_ORIGIN: "",
    DEV: false,
    HOST: "app.unpkg.com",
    NAME: "production",
    WWW_ORIGIN: "https://unpkg.com",
  },
  staging: {
    APP_ORIGIN: "https://app.unpkg.dev",
    ASSETS_ORIGIN: "",
    DEV: false,
    HOST: "app.unpkg.dev",
    NAME: "staging",
    WWW_ORIGIN: "https://unpkg.dev",
  },
};

const envName = process.env.NODE_ENV ?? "production";
if (!(envName in envs)) {
  throw new Error(`Invalid NODE_ENV: ${envName}`);
}

export const env = envs[envName];
