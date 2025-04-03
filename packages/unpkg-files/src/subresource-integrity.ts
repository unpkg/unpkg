import crypto from "node:crypto";

export function getSubresourceIntegrity(buffer: Uint8Array, algorithm = "sha256"): string {
  let hash = crypto.createHash(algorithm).update(buffer).digest("base64");
  return `${algorithm}-${hash}`;
}
