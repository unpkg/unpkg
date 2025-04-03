import { STATUS_CODES } from "node:http";

import chalk from "chalk";
import * as esbuild from "esbuild";

import { loadAssetsConfig } from "./utils/assets-config.ts";

let config = await loadAssetsConfig();
let buildOptions = config.getBuildOptions({ dev: true });

let ctx = await esbuild.context(buildOptions);

await ctx.watch();

let { host, port } = await ctx.serve({
  // @ts-expect-error - esbuild types are not up to date
  onRequest({ method, path, status: statusCode, timeInMS: ms }) {
    let timestamp = chalk.gray(`[${new Date().toLocaleTimeString("en-US")}]`);
    // prettier-ignore
    let statusColor = statusCode < 200 ? chalk.gray : statusCode < 300 ? chalk.greenBright : statusCode < 400 ? chalk.cyanBright : chalk.redBright;
    let status = statusColor(statusCode);
    // prettier-ignore
    let statusTextColor = statusCode < 200 ? chalk.gray : statusCode < 300 ? chalk.green : statusCode < 400 ? chalk.cyan : chalk.red;
    let statusText = statusTextColor(STATUS_CODES[statusCode]);
    let duration = chalk.gray(ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(2)}s`);

    console.log(`${timestamp} ${method} ${path} ${status} ${statusText} ${duration}`);
  },
  ...config.getServeOptions(),
});

console.log(`Assets server listening on http://${host}:${port} ...`);
console.log();
