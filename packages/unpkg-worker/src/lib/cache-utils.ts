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
