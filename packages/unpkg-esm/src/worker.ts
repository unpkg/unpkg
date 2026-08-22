import { isCacheableResponse, waitUntilCachePut } from "unpkg-worker";

import type { Env } from "./env.ts";
import { handleRequest } from "./request-handler.ts";

// @ts-expect-error - `caches.default` is missing in @cloudflare/workers-types
const cache = caches.default as Cache;

export default {
  async fetch(request, env, context) {
    try {
      let url = new URL(request.url);
      let shouldUseCache =
        env.MODE !== "development" && env.MODE !== "test" && url.pathname !== "/" && url.pathname !== "/index.html";
      let response = shouldUseCache ? await cache.match(request) : undefined;

      if (!response) {
        response = await handleRequest(request, env, context);

        if (shouldUseCache && isCacheableResponse(request, response)) {
          waitUntilCachePut(context, cache, request, response.clone(), "unpkg-esm");
        }
      }

      if (request.method === "HEAD") {
        return new Response(null, response);
      }

      return response;
    } catch (error) {
      console.error(error);

      return new Response("Internal Server Error", { status: 500 });
    }
  },
} satisfies ExportedHandler<Env>;
