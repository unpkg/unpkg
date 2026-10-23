import {
  BODY_VERIFICATION_HEADER,
  getContentLength,
  isCacheableResponse,
  parseContentDigest,
  parsePackagePathname,
  stripBodyVerificationMarker,
  wrapWithVerificationAudit,
} from "unpkg-worker";

import { getCacheGeneration, setRequestCacheGeneration } from "./cache-generations.ts";
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
      let shielded = false;
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
              // Only mark shielded once the rewrite has actually been applied,
              // so a failure above degrades to serving the original request
              // with its original headers.
              shielded = true;
            }
          }
        } catch (error) {
          console.error("Shield enforcement failed (fail-open):", error);
        }
      }

      // Cache generations (independent of Shield): if ops has evicted
      // this exact package version, derive the public cache key with its
      // generation so entries written under older keys are orphaned.
      // Generation 0 — the overwhelming majority — keeps today's key
      // byte-for-byte. Fail-open: any problem degrades to generation 0.
      //
      // `__unpkg_g` is a reserved parameter: it is stripped from the
      // request whenever present so clients can neither fragment cache
      // keys nor pre-seed a future generation's key with stale bytes,
      // and so it never rides handler redirects into shared URLs.
      let cacheRequest = request;
      let exactVersionPath = false;
      if (isPackagePath(url.pathname)) {
        try {
          let parsed = parsePackagePathname(url.pathname);
          exactVersionPath =
            parsed?.version != null &&
            /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(parsed.version);
          let generation = 0;
          if (exactVersionPath && env.CACHE_GENERATIONS) {
            generation = await getCacheGeneration(env, context, parsed!.package, parsed!.version!);
          }
          if (generation > 0) {
            setRequestCacheGeneration(request, generation);
            let cacheUrl = new URL(request.url);
            cacheUrl.searchParams.set("__unpkg_g", String(generation));
            // Cast: same workerd Request typing note as the Shield rewrite.
            cacheRequest = new Request(cacheUrl, request) as typeof request;
          }
          if (url.searchParams.has("__unpkg_g")) {
            let strippedUrl = new URL(request.url);
            strippedUrl.searchParams.delete("__unpkg_g");
            request = new Request(strippedUrl, request) as typeof request;
            url = new URL(request.url);
            if (generation > 0) setRequestCacheGeneration(request, generation);
            else cacheRequest = request;
          }
        } catch (error) {
          console.error("Cache generation lookup failed (fail-open):", error);
          cacheRequest = request;
        }
      }

      // Non-exact versions (ranges, tags) always redirect to the exact
      // URL in the handler, so no cacheable entry can exist under them;
      // skipping the lookup keeps evicted versions unreachable here too.
      let hasVersionToken = isPackagePath(url.pathname) && parsePackagePathname(url.pathname)?.version != null;
      let shouldUseCache =
        url.pathname !== "/" && url.pathname !== "/index.html" && (!hasVersionToken || exactVersionPath);
      let response = shouldUseCache ? await cache.match(cacheRequest) : undefined;
      let cacheMiss = response == null;

      if (response) {
        response = auditCachedResponse(cache, cacheRequest, response);
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
      response = stripBodyVerificationMarker(response);

      if (
        cacheMiss &&
        shouldUseCache &&
        request.method === "GET" &&
        response.status === 200 &&
        response.headers.has("Cache-Control") &&
        isCacheableResponse(response) &&
        !bodyPendingVerification
      ) {
        // Clone before any shielded-response mutation below: the edge entry
        // belongs to the rewritten (clean) URL and keeps its normal lifetime.
        // Stored under cacheRequest, which carries any cache generation.
        context.waitUntil(cache.put(cacheRequest, response.clone()).catch(() => {}));
      }

      if (shielded) {
        // The browser asked for the malicious URL and cannot see the internal
        // rewrite, so it would store substitute bytes under that URL for the
        // response's normal lifetime. Never let it: a lifted pin must take
        // effect on the next request. Only this browser-facing copy changes;
        // the edge entry above is stored under the clean URL as usual.
        response = new Response(response.body, response);
        response.headers.set("Cache-Control", "no-store");
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
