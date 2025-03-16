import * as url from "node:url";
import * as path from "node:path";
import { Miniflare } from "miniflare";

import * as fixtures from "./fixtures.ts";

const __dirname = url.fileURLToPath(new URL(".", import.meta.url));

export const miniflare = new Miniflare({
  bindings: {
    APP_HOST: "app.unpkg.com",
    ASSETS_ORIGIN: "https://unpkg.com",
    HOST: "unpkg.com",
    MODE: "test",
  },
  compatibilityDate: "2024-12-05",
  compatibilityFlags: ["nodejs_compat_v2"],
  scriptPath: path.resolve(__dirname, "../dist/index.js"),
  modules: true,
  outboundService(request) {
    switch (request.url) {
      case "https://registry.npmjs.org/lodash":
        return Response.json(fixtures.packageInfo.lodash);
      case "https://registry.npmjs.org/preact":
        return Response.json(fixtures.packageInfo.preact);
      case "https://registry.npmjs.org/react":
        return Response.json(fixtures.packageInfo.react);
      case "https://registry.npmjs.org/lodash/-/lodash-4.17.21.tgz":
        return binaryResponse(fixtures.packageTarballs.lodash["4.17.21"]);
      case "https://registry.npmjs.org/react/-/react-18.2.0.tgz":
        return binaryResponse(fixtures.packageTarballs.react["18.2.0"]);
      default:
        throw new Error(`Unexpected outbound request: ${request.url}`);
    }
  },
});

function binaryResponse(body: Uint8Array): Response {
  return new Response(body, {
    headers: { "Content-Type": "application/octet-stream" },
  });
}
