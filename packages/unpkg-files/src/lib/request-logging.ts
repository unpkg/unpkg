import { STATUS_CODES } from "node:http";

import chalk from "chalk";

export function logRequest(request: Request, response: Response, ms: number) {
  let timestamp = chalk.gray(`[${new Date().toLocaleTimeString("en-US")}]`);
  let method = request.method;
  let url = new URL(request.url);
  let path = url.pathname + url.search;
  let statusCode = response.status;
  // prettier-ignore
  let statusColor = statusCode < 200 ? chalk.gray : statusCode < 300 ? chalk.greenBright : statusCode < 400 ? chalk.cyanBright : chalk.redBright;
  let status = statusColor(statusCode);
  // prettier-ignore
  let statusTextColor = statusCode < 200 ? chalk.gray : statusCode < 300 ? chalk.green : statusCode < 400 ? chalk.cyan : chalk.red;
  let statusText = statusTextColor(STATUS_CODES[statusCode]);
  let duration = chalk.gray(ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(2)}s`);

  console.log(`${timestamp} ${method} ${path} ${status} ${statusText} ${duration}`);
}
