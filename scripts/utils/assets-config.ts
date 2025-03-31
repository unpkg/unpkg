import * as esbuild from "esbuild";
import * as path from "node:path";

import { pathToFileURL } from "node:url";

export interface AssetsConfig {
  projectDir: string;
  getBuildOptions(options?: { dev?: boolean }): esbuild.BuildOptions;
  getServeOptions(): esbuild.ServeOptions;
}

export async function loadAssetsConfig(projectDir = process.cwd()): Promise<AssetsConfig> {
  let configFile = path.resolve(projectDir, "assets-config.ts");
  let configFileUrl = pathToFileURL(configFile).href;

  try {
    let config = await import(configFileUrl);
    return { projectDir, ...config };
  } catch (error) {
    if (isNoEntityError(error)) {
      console.error(`Assets config file not found: ${configFile}`);
    } else {
      console.error(`Error reading assets config file: ${configFile}`);
      console.error(error);
    }

    process.exit(1);
  }
}

function isNoEntityError(error: unknown): error is Error & { code: "ENOENT" } {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}
