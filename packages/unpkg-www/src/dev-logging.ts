import { STATUS_CODES } from "node:http";

import chalk from "chalk";

export function devLogger(request: Request, response: Response, ms: number) {
  let method = request.method;
  let url = new URL(request.url);
  let path = url.pathname + url.search;
  let status = response.status;

  // prettier-ignore
  let statusColor = status < 200 ? chalk.gray : status < 300 ? chalk.greenBright : status < 400 ? chalk.cyanBright : chalk.redBright;
  // prettier-ignore
  let statusTextColor = status < 200 ? chalk.gray : status < 300 ? chalk.green : status < 400 ? chalk.cyan : chalk.red;
  let statusText = STATUS_CODES[status];

  console.log(
    `${chalk.gray(`[${new Date().toLocaleTimeString("en-US")}]`)} ${method} ${path} ${statusColor(status)} ${statusTextColor(statusText)} ${chalk.gray(`(${ms}ms)`)}`,
  );
}
