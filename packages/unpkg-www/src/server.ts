import { handleRequest } from "./request-handler.tsx";

let server = Bun.serve({
  fetch: handleRequest,
});

console.log(`Server listening on http://${server.hostname}:${server.port} ...`);
console.log();
