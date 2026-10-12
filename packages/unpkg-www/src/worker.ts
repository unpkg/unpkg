import type { Env } from "./env.ts";
import { handleRequest } from "./request-handler.tsx";
import { withUtf8Charset } from "./response.ts";
import {
  buildBlockResponse,
  evaluateShieldRequest,
  getShieldRules,
  isPackagePath,
} from "./shield.ts";

export default {
  async fetch(request, env, context) {
    try {
      // @ts-expect-error - `caches.default` is missing in @cloudflare/workers-types
      let cache = caches.default as Cache;
      let url = new URL(request.url);

      // Shield version pinning: fail-open enforcement before the cache
      // lookup, so swapped requests benefit from the (usually warm)
      // clean-version cache entry. Skipped entirely for non-package paths
      // and when Shield is unconfigured. The whole block is guarded: Shield
      // must never break a request, including via its own bugs — an API
      // outage, a corrupt cache entry, or an unexpected exception all
      // degrade to plain unpkg.
      if (isPackagePath(url.pathname)) {
        try {
          let shieldRules = await getShieldRules(env, context);
          if (shieldRules) {
            let decision = evaluateShieldRequest(url, request, shieldRules);
            if (decision.type === "block") {
              return buildBlockResponse(decision.pkg, decision.version);
            }
            if (decision.type === "rewrite") {
              // Cast: workerd accepts a standard Request here at runtime; the
              // CfProperties typing is only relevant to incoming requests.
              request = new Request(new URL(decision.location, url.origin), request) as typeof request;
              url = new URL(request.url);
            }
          }
        } catch (error) {
          console.error("Shield enforcement failed (fail-open):", error);
        }
      }

      let shouldUseCache = url.pathname !== "/" && url.pathname !== "/index.html";
      let response = shouldUseCache ? await cache.match(request) : undefined;
      let cacheMiss = response == null;

      if (!response) {
        response = await handleRequest(request, env, context);
      }

      response = withUtf8Charset(response);

      if (
        cacheMiss &&
        shouldUseCache &&
        request.method === "GET" &&
        response.status === 200 &&
        response.headers.has("Cache-Control")
      ) {
        context.waitUntil(cache.put(request, response.clone()));
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
