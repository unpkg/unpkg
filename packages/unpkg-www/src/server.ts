import { handleRequest } from "./request-handler.tsx";

let server = Bun.serve({
  // Give unpkg-www-worker more time to process requests.
  idleTimeout: process.env.FLY_APP_NAME === "unpkg-www-worker" ? 30 : 5,
  fetch: handleRequest,
});

console.log(`Server listening on http://${server.hostname}:${server.port} ...`);
console.log();
