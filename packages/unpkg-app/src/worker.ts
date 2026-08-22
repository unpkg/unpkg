import { isCacheableResponse, retryOnNetworkConnectionLost, waitUntilCachePut } from "unpkg-worker";

import type { Env } from "./env.ts";
import { handleRequest } from "./request-handler.tsx";

// @ts-expect-error - `caches.default` is missing in @cloudflare/workers-types
const cache = caches.default as Cache;

export default {
  async fetch(request, env, context) {
    try {
      let response = await retryOnNetworkConnectionLost(() => cache.match(request));

      if (!response) {
        response =
          request.method === "GET" || request.method === "HEAD"
            ? await retryOnNetworkConnectionLost(() => handleRequest(request, env, context))
            : await handleRequest(request, env, context);

        if (isCacheableResponse(request, response)) {
          waitUntilCachePut(context, cache, request, response.clone(), "unpkg-app");
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
