import { env } from "./env.ts";

export function files(packageName: string, version?: string, filename?: string): string {
  // The /files prefix is not needed for the root of the file browser.
  let path = filename == null || filename === "/" ? "" : `/files${filename.replace(/\/+$/, "")}`;
  let url = new URL(`/${packageName}${version ? `@${version}` : ""}${path}`, env.APP_ORIGIN);
  return url.href;
}
