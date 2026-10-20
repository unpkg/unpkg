import {
  BODY_VERIFICATION_HEADER,
  getContentLength,
  isCacheableResponse,
  parseContentDigest,
  wrapWithVerificationAudit,
} from "unpkg-worker";

import type { Env } from "./env.ts";
import { handleRequest } from "./request-handler.tsx";
import { withUtf8Charset } from "./response.ts";
import {
  buildBlockResponse,
  evaluateShieldRequest,
  getShieldRules,
  isPackagePath,
} from "./shield.ts";

// Audits a caches.default entry as it is served. This is the hot path, so
// the body is never buffered here: it streams through a counter (and a
// digest stream where available), and a mismatch at end-of-stream errors
// the response and evicts the entry so the next request refetches.
// Entries whose stored headers carry neither Content-Length nor
// Content-Digest cannot be checked and are served as before.
function auditCachedResponse(cache: Cache, request: Request, response: Response): Response {
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

      if (response) {
        response = auditCachedResponse(cache, request, response);
      }

      if (!response) {
        response = await handleRequest(request, env, context);
      }

      response = withUtf8Charset(response);

      // A streamed file body that is still being verified must not be
      // written to this cache layer: if its stream later fails, a cache
      // write can still commit a partial entry. The shared fetch helper
      // caches such bodies itself once verification completes. The
      // marker is internal and is stripped before serving.
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
