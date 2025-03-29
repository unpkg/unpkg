import { createServer } from "node:http";
import { createRequestListener } from "@mjackson/node-fetch-server";

import { handleRequest } from "./request-handler.tsx";

const PORT = process.env.PORT ?? 3000;

let server = createServer(createRequestListener(handleRequest));

server.listen(PORT, () => {
  console.log(`Server listening on http://localhost:${PORT} ...`);
  console.log();
});
