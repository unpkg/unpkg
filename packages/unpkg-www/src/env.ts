export interface Env {
  APP_ORIGIN: string;
  ASSETS_ORIGIN: string;
  DEV: boolean;
  HOST: string;
  NAME: "development" | "production" | "staging" | "test";
}

const envs: Record<string, Env> = {
  development: {
    APP_ORIGIN: "http://localhost:3001",
    ASSETS_ORIGIN: "http://localhost:8000",
    DEV: true,
    HOST: "localhost:3000",
    NAME: "development",
  },
  production: {
    APP_ORIGIN: "https://app.unpkg.com",
    ASSETS_ORIGIN: "",
    DEV: false,
    HOST: "unpkg.com",
    NAME: "production",
  },
  staging: {
    APP_ORIGIN: "https://app.unpkg.dev",
    ASSETS_ORIGIN: "",
    DEV: false,
    HOST: "unpkg.dev",
    NAME: "staging",
  },
};

const envName = process.env.NODE_ENV ?? "production";
if (!(envName in envs)) {
  throw new Error(`Invalid NODE_ENV: ${envName}`);
}

export const env = envs[envName];
