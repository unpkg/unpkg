export async function getSubresourceIntegrity(buffer: Uint8Array): Promise<string> {
  // Use SHA-256 for the hash
  let digest = await crypto.subtle.digest("SHA-256", buffer);

  // Convert ArrayBuffer to base64 more efficiently using chunks
  // to avoid "Maximum call stack size exceeded" errors with large arrays
  let bytes = new Uint8Array(digest);
  let binary = "";
  let chunkSize = 8192; // Process in chunks to avoid call stack issues

  for (let i = 0; i < bytes.length; i += chunkSize) {
    let view = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode.apply(null, view as unknown as number[]);
  }

  return `sha256-${btoa(binary)}`;
}
