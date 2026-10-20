import {
  BODY_VERIFICATION_HEADER,
  getContentLength,
  isCacheableResponse,
  parseContentDigest,
  wrapWithVerificationAudit,
} from "unpkg-worker";

import type { Env } from "./env.ts";
import { handleRequest } from "./request-handler.ts";

// @ts-expect-error - `caches.default` is missing in @cloudflare/workers-types
const cache = caches.default as Cache;

// Audits a cached entry as it is served, mirroring the public worker:
// the body streams through a counter (and a digest stream where
// available), and a mismatch errors the response and evicts the entry.
// Entries whose stored headers carry neither Content-Length nor
// Content-Digest cannot be checked and are served as before.
function auditCachedResponse(request: Request, response: Response): Response {
  let length = getContentLength(response.headers);
  let digest = parseContentDigest(response.headers);

  if ((length == null && digest == null) || response.body == null) {
    return response;
  }

  return new Response(
    wrapWithVerificationAudit(response.body, response.headers, () => {
      console.warn(`Evicting corrupt cache entry: ${request.url}`);
      void cache.delete(request);
    }),
    response
  );
}

export default {
  async fetch(request, env, context) {
    try {
      let url = new URL(request.url);
      let shouldUseCache =
        env.MODE !== "development" && env.MODE !== "test" && url.pathname !== "/" && url.pathname !== "/index.html";
      let response = shouldUseCache ? await cache.match(request) : undefined;
      let cacheMiss = response == null;

      if (response) {
        response = auditCachedResponse(request, response);
      }

      if (!response) {
        response = await handleRequest(request, env, context);
      }

      // Streamed bodies that are still being verified must not be stored
      // by this layer; the marker is internal and stripped before serving.
      let bodyPendingVerification = response.headers.get(BODY_VERIFICATION_HEADER) === "pending";
      response.headers.delete(BODY_VERIFICATION_HEADER);

      if (
        cacheMiss &&
        shouldUseCache &&
        request.method === "GET" &&
        response.status === 200 &&
        response.headers.has("Cache-Control") &&
        isCacheableResponse(response) &&
        !bodyPendingVerification
      ) {
        context.waitUntil(cache.put(request, response.clone()).catch(() => {}));
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
