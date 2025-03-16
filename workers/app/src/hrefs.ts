import { createContext } from "./context.ts";
import { type Env } from "./env.ts";

export const HrefsContext = createContext<HrefBuilder>();

export class HrefBuilder {
  #env: Env;

  constructor(env: Env) {
    this.#env = env;
  }

  files(packageName: string, version: string, filename = "/"): string {
    return `/${packageName}@${version}${filename === "/" ? "" : "/files" + filename}`;
  }

  home() {
    return this.#env.WWW_ORIGIN;
  }

  raw(packageName: string, version: string, filename: string): string {
    return `${this.#env.WWW_ORIGIN}/${packageName}@${version}${filename}`;
  }
}
