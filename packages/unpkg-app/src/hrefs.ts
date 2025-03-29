import { env } from "./env.ts";

export function files(packageName: string, version?: string, filename?: string): string {
  // The /files prefix is not needed for the root of the file browser.
  let path = filename == null || filename === "/" ? "" : `/files${filename.replace(/\/+$/, "")}`;
  return `/${packageName}${version ? `@${version}` : ""}${path}`;
}

export function home(): string {
  return env.WWW_ORIGIN;
}

export function raw(packageName: string, version: string, filename: string): string {
  let url = new URL(`/${packageName}@${version}${filename}`, env.WWW_ORIGIN);
  return url.href;
}
