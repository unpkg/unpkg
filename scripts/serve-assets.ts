import { STATUS_CODES } from "node:http";

import chalk from "chalk";
import * as esbuild from "esbuild";

import { loadAssetsConfig } from "./utils/assets-config.ts";

let config = await loadAssetsConfig();
let buildOptions = config.getBuildOptions({ dev: true });

let ctx = await esbuild.context(buildOptions);

await ctx.watch();

let { host, port } = await ctx.serve({
  onRequest({ method, path, status, timeInMS: ms }) {
    // prettier-ignore
    let statusColor = status < 200 ? chalk.gray : status < 300 ? chalk.greenBright : status < 400 ? chalk.cyanBright : chalk.redBright;
    // prettier-ignore
    let statusTextColor = status < 200 ? chalk.gray : status < 300 ? chalk.green : status < 400 ? chalk.cyan : chalk.red;
    let statusText = STATUS_CODES[status];

    console.log(
      `${chalk.gray(`[${new Date().toLocaleTimeString("en-US")}]`)} ${method} ${path} ${statusColor(status)} ${statusTextColor(statusText)} ${chalk.gray(`(${ms}ms)`)}`,
    );
  },
  ...config.getServeOptions(),
});

console.log(`Assets server listening on http://${host}:${port} ...`);
console.log();
