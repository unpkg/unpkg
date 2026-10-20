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

// Responses an origin has marked non-cacheable must never be stored, in any
// cache layer. An origin-supplied Cache-Control always wins over defaults.
export function isCacheableResponse(response: Response): boolean {
  let cacheControl = response.headers.get("Cache-Control");
  if (cacheControl == null) {
    return true;
  }

  let tokens = cacheControl
    .toLowerCase()
    .split(",")
    .map((token) => token.trim().split("=")[0].trim());

  return !tokens.some((token) => token === "no-store" || token === "no-cache" || token === "private");
}

export function getContentLength(headers: Headers): number | null {
  let value = headers.get("Content-Length");
  if (value == null) {
    return null;
  }

  let length = Number(value);
  return Number.isSafeInteger(length) && length >= 0 ? length : null;
}

export interface ContentDigest {
  algorithm: string;
  hash: string;
}

export function parseContentDigest(headers: Headers): ContentDigest | null {
  let digest = headers.get("Content-Digest");
  if (digest == null) {
    return null;
  }

  let match = /^([a-zA-Z0-9]+)=:([A-Za-z0-9+/=]+):$/.exec(digest.trim());
  if (match == null) {
    return null;
  }

  return { algorithm: match[1].toLowerCase(), hash: match[2] };
}

export function arrayBufferToBase64(buffer: ArrayBuffer): string {
  let bytes = new Uint8Array(buffer);
  let binary = "";
  let chunkSize = 0x8000;

  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }

  return btoa(binary);
}

export async function sha256Base64(body: Uint8Array): Promise<string> {
  let copy = new Uint8Array(body);
  let hash = await crypto.subtle.digest("SHA-256", copy.buffer);
  return arrayBufferToBase64(hash);
}

export type BodyVerification = { ok: true } | { ok: false; reason: "length" | "digest" };

// Self-consistency check: the body is compared only against the headers of
// its own response, never against any external expectation of the content.
export async function verifyBody(headers: Headers, body: Uint8Array): Promise<BodyVerification> {
  let length = getContentLength(headers);
  if (length != null && body.byteLength !== length) {
    return { ok: false, reason: "length" };
  }

  let digest = parseContentDigest(headers);
  if (digest != null && digest.algorithm === "sha256") {
    let actual = await sha256Base64(body);
    if (actual !== digest.hash) {
      return { ok: false, reason: "digest" };
    }
  }

  return { ok: true };
}
