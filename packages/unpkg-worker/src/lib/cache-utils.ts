export function createCacheableResponse(response: Response): Response {
  let clone = response.clone();
  let headers = new Headers(clone.headers);

  // Cloudflare cannot cache responses with Set-Cookie headers
  // See https://developers.cloudflare.com/workers/runtime-apis/cache/
  headers.delete("Set-Cookie");

  return new Response(clone.body, {
    status: clone.status,
    headers,
  });
}

export function isCacheableResponse(request: Request, response: Response): boolean {
  return (
    request.method === "GET" &&
    (response.status === 200 || response.status === 301 || response.status === 302) &&
    response.headers.has("Cache-Control")
  );
}

export function waitUntilCachePut(
  context: ExecutionContext,
  cache: Cache,
  request: Request,
  response: Response,
  cacheName: string
): void {
  context.waitUntil(
    cache.put(request, response).catch((error: unknown) => {
      if (isNetworkConnectionLostError(error)) {
        console.warn(`Cache write failed (${cacheName}): ${getErrorMessage(error)}`);
      } else {
        console.error(`Cache write failed (${cacheName}):`, error);
      }
    })
  );
}

function isNetworkConnectionLostError(error: unknown): boolean {
  return getErrorMessage(error).replace(/\.$/, "") === "Network connection lost";
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
