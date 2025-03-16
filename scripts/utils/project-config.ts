import * as esbuild from "esbuild";
import * as path from "node:path";

export interface ProjectConfig {
  projectDir: string;
  getBuildOptions(options?: { dev?: boolean }): esbuild.BuildOptions;
  getServeOptions(): esbuild.ServeOptions;
}

export async function loadProjectConfig(
  projectDir = process.cwd()
): Promise<ProjectConfig> {
  let configFile = path.resolve(projectDir, "config.ts");

  try {
    let config = await import(configFile);
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
