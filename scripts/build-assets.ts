import * as fsp from "node:fs/promises";

import chalk from "chalk";
import * as esbuild from "esbuild";
import prettyBytes from "pretty-bytes";

import { loadAssetsConfig } from "./utils/assets-config.ts";

let config = await loadAssetsConfig();
let buildOptions = config.getBuildOptions();

// Clear out any previous builds
if (buildOptions.outdir) {
  await fsp.rm(buildOptions.outdir, { recursive: true, force: true });
}

let result = await esbuild.build({
  ...buildOptions,
  metafile: true,
});

let metafile = result.metafile;
let manifest: Record<string, string> = {};

for (let file in metafile.outputs) {
  let { bytes, entryPoint } = metafile.outputs[file];

  if (entryPoint) {
    console.log(`${entryPoint} => ${file} ${chalk.gray(`(${prettyBytes(bytes)})`)}`);

    manifest[entryPoint] = file.replace(/^public\//, "/");
  }
}

// Write the manifest to a file in the project directory
await fsp.writeFile("assets-manifest.json", JSON.stringify(manifest, null, 2));

console.log("manifest => assets-manifest.json");
