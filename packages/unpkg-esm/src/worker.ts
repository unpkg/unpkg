import {
  isCacheableResponse,
  isNetworkConnectionLostError,
  retryOnNetworkConnectionLost,
  waitUntilCachePut,
} from "unpkg-worker";

import type { Env } from "./env.ts";
import { handleRequest } from "./request-handler.ts";

export default {
  async fetch(request, env, context) {
    try {
      // @ts-expect-error - `caches.default` is missing in @cloudflare/workers-types
      let cache = caches.default as Cache;
      let url = new URL(request.url);
      let shouldUseCache =
        env.MODE !== "development" && env.MODE !== "test" && url.pathname !== "/" && url.pathname !== "/index.html";
      let response = shouldUseCache ? await retryOnNetworkConnectionLost(() => cache.match(request)) : undefined;

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

      if (isNetworkConnectionLostError(error)) {
        return new Response("Service Unavailable", {
          status: 503,
          headers: { "Retry-After": "1" },
        });
      }

      return new Response("Internal Server Error", { status: 500 });
    }
  },
} satisfies ExportedHandler<Env>;
