import type { Env } from "./env.ts";
import { handleRequest } from "./request-handler.tsx";

// @ts-expect-error - `caches.default` is missing in @cloudflare/workers-types
const cache = caches.default as Cache;

export default {
  async fetch(request, env, context) {
    try {
      let response = await cache.match(request);

      if (!response) {
        response = await handleRequest(request, env, context);

        if (request.method === "GET" && response.status === 200 && response.headers.has("Cache-Control")) {
          context.waitUntil(cache.put(request, response.clone()));
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
