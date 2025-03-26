export async function getSubresourceIngtegrity(buffer: Uint8Array): Promise<string> {
  // Use SHA-256 so we can reuse the same hash for the Content-Digest header
  let digest = await crypto.subtle.digest("SHA-256", buffer);
  let base64 = btoa(String.fromCharCode.apply(null, new Uint8Array(digest) as any));
  return `sha256-${base64}`;
}
