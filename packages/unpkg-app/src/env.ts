export interface Env {
  ASSETS_ORIGIN: string;
  DEV: boolean;
  HOST: string;
  NAME: "development" | "production" | "staging" | "test";
  WWW_ORIGIN: string;
}

const envs: Record<string, Env> = {
  development: {
    ASSETS_ORIGIN: "http://localhost:8001",
    DEV: true,
    HOST: "localhost:3001",
    NAME: "development",
    WWW_ORIGIN: "http://localhost:3000",
  },
  production: {
    ASSETS_ORIGIN: "",
    DEV: false,
    HOST: "app.unpkg.com",
    NAME: "production",
    WWW_ORIGIN: "https://unpkg.com",
  },
  staging: {
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
