export interface Env {
  DEBUG: boolean;
  DEV: boolean;
  MODE: "development" | "production" | "staging" | "test";
  ORIGIN: string;
}

const envs: Record<Env["MODE"], Env> = {
  development: {
    DEBUG: true,
    DEV: true,
    MODE: "development",
    ORIGIN: "http://localhost:3000",
  },
  production: {
    DEBUG: !!(process.env.DEBUG ?? false),
    DEV: false,
    MODE: "production",
    ORIGIN: "https://files.unpkg.com",
  },
  staging: {
    DEBUG: !!(process.env.DEBUG ?? false),
    DEV: false,
    MODE: "staging",
    ORIGIN: "https://files.unpkg.dev",
  },
  test: {
    DEBUG: false,
    DEV: false,
    MODE: "test",
    ORIGIN: "http://files.unpkg.com",
  },
};

let mode = (process.env.MODE ?? "development") as Env["MODE"];
if (!(mode in envs)) {
  throw new Error(`Invalid MODE: ${mode}`);
}

export const env = envs[mode];
