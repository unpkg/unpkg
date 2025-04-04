import type { Env } from "./env.ts";

export class HrefBuilder {
  #env: Env;

  constructor(env: Env) {
    this.#env = env;
  }

  files(packageName: string, version?: string, filename?: string): string {
    // The /files prefix is not needed for the root of the file browser.
    let path = filename == null || filename === "/" ? "" : `/files${filename.replace(/\/+$/, "")}`;
    let url = new URL(`/${packageName}${version ? `@${version}` : ""}${path}`, this.#env.ORIGIN);
    return url.href;
  }

  home(): string {
    return this.#env.WWW_ORIGIN;
  }

  raw(packageName: string, version: string, filename: string): string {
    let url = new URL(`/${packageName}@${version}${filename}`, this.#env.WWW_ORIGIN);
    return url.href;
  }
}
