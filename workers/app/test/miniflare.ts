import * as url from "node:url";
import * as path from "node:path";
import { Miniflare } from "miniflare";

import * as fixtures from "./fixtures.ts";

const __dirname = url.fileURLToPath(new URL(".", import.meta.url));

export let miniflare = new Miniflare({
  bindings: {
    ASSETS_ORIGIN: "https://app.unpkg.com",
    HOST: "app.unpkg.com",
    MODE: "test",
    WWW_ORIGIN: "https://unpkg.com",
  },
  compatibilityDate: "2024-12-05",
  compatibilityFlags: ["nodejs_compat_v2"],
  scriptPath: path.resolve(__dirname, "../dist/index.js"),
  modules: true,
  outboundService(request) {
    switch (request.url) {
      case "https://registry.npmjs.org/react":
        return Response.json(fixtures.packageInfo.react);
      default:
        throw new Error(`Unexpected outbound request: ${request.url}`);
    }
  },
});
