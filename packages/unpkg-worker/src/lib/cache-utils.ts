export function createCacheableResponse(response: Response, body?: BodyInit | null): Response {
  let source = body === undefined ? response.clone() : response;
  let headers = new Headers(source.headers);

  // Cloudflare cannot cache responses with Set-Cookie headers
  // See https://developers.cloudflare.com/workers/runtime-apis/cache/
  headers.delete("Set-Cookie");

  return new Response(body === undefined ? source.body : body, {
    status: source.status,
    headers,
  });
}

export interface BufferedResponse {
  body: ArrayBuffer;
  response: Response;
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

export async function retryOnNetworkConnectionLost<T>(
  operation: () => Promise<T>,
  retryDelayMs = 25 + Math.floor(Math.random() * 50)
): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (!isNetworkConnectionLostError(error)) {
      throw error;
    }
  }

  if (retryDelayMs > 0) {
    await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
  }

  return operation();
}

export async function readResponseWithNetworkRetry(operation: () => Promise<Response>): Promise<BufferedResponse> {
  return retryOnNetworkConnectionLost(async () => {
    let response = await operation();
    let body = await response.arrayBuffer();

    return { body, response };
  });
}

export async function readOptionalResponseWithNetworkRetry(
  operation: () => Promise<Response | undefined>
): Promise<BufferedResponse | undefined> {
  return retryOnNetworkConnectionLost(async () => {
    let response = await operation();
    if (response == null) return undefined;

    let body = await response.arrayBuffer();
    return { body, response };
  });
}

export function isNetworkConnectionLostError(error: unknown): boolean {
  return getErrorMessage(error).replace(/\.$/, "") === "Network connection lost";
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
