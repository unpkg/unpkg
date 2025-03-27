import type * as esbuild from "esbuild";
import { esbuildPluginTailwind } from "@ryanto/esbuild-plugin-tailwind";

export function getBuildOptions({ dev = false } = {}): esbuild.BuildOptions {
  return {
    bundle: true,
    define: {
      "window.__DEV__": JSON.stringify(dev),
    },
    entryNames: dev ? "[dir]/[name]" : "[dir]/[name]-[hash]",
    entryPoints: ["src/code-light.css", "src/scripts.ts", "src/styles.css"],
    format: "esm",
    outbase: "src",
    outdir: "public/_assets",
    packages: "external",
    sourcemap: dev,
    write: !dev,
    plugins: [
      esbuildPluginTailwind({
        base: process.cwd(),
      }),
    ],
  };
}

export function getServeOptions(): esbuild.ServeOptions {
  return {
    host: "localhost",
    port: 8000,
  };
}
