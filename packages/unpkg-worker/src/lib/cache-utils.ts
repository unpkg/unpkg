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

export async function observeIoOperation<T>(operation: string, run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    console.warn(`Worker I/O failed (${operation}): ${getErrorMessage(error)}`);
    throw error;
  }
}

function isNetworkConnectionLostError(error: unknown): boolean {
  return getErrorMessage(error).replace(/\.$/, "") === "Network connection lost";
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
