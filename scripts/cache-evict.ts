#!/usr/bin/env bun
/**
 * Evict one exact package version from unpkg's Cache API layers.
 *
 * Usage:
 *   bun scripts/cache-evict.ts <package@version> [--env staging|production] [--dry-run]
 *
 * This increments the version's cache generation in the
 * CACHE_GENERATIONS Workers KV document (`cache-generations:v1`).
 * Workers pick the document up on their normal refresh; from then on
 * that version's cache keys are derived with the new generation, so
 * entries written under older keys are orphaned and refetched.
 *
 * The document contains ONLY evicted versions. Each entry expires
 * 400 days after its last bump (beyond the 1-year maximum lifetime of
 * the entries it displaces); expired entries are pruned on each write
 * and ignored by Workers even before pruning.
 *
 * Requires a Cloudflare credential with Workers KV write access
 * (the same wrangler OAuth/API token used for deploys).
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export const GENERATIONS_KV_KEY = "cache-generations:v1";
export const EXPIRY_DAYS = 400;
export const WARN_BYTES = 512 * 1024;
export const MAX_BYTES = 5 * 1024 * 1024;

export interface GenerationEntry {
  gen: number;
  expires_at: string;
}

export interface GenerationsDocument {
  schema: 1;
  v: number;
  generations: Record<string, GenerationEntry>;
}

export function parsePackageVersionArg(arg: string): { packageName: string; version: string } {
  const match = /^((?:@[^/@]+\/)?[^/@]+)@([^/@\s]+)$/.exec(arg.trim());
  if (!match) {
    throw new Error(`Expected <package@version> (e.g. lodash@4.17.20 or @scope/pkg@1.0.0), got: ${arg}`);
  }
  return { packageName: match[1].toLowerCase(), version: match[2] };
}

export function emptyDocument(): GenerationsDocument {
  return { schema: 1, v: 0, generations: {} };
}

export function parseDocument(text: string | null): GenerationsDocument {
  if (text == null || text.trim() === "") return emptyDocument();
  const parsed = JSON.parse(text) as Record<string, unknown>;
  if (parsed["schema"] !== 1 || typeof parsed["generations"] !== "object" || parsed["generations"] == null) {
    throw new Error("Existing cache-generations document has an unexpected shape; refusing to overwrite it");
  }
  return {
    schema: 1,
    v: typeof parsed["v"] === "number" ? parsed["v"] : 0,
    generations: parsed["generations"] as Record<string, GenerationEntry>,
  };
}

/** Return a new document with `key` bumped, expired entries pruned. Pure. */
export function bumpDocument(doc: GenerationsDocument, key: string, now: Date): GenerationsDocument {
  const generations: Record<string, GenerationEntry> = {};
  for (const [entryKey, entry] of Object.entries(doc.generations)) {
    // Normalize the compact [gen, epochSeconds] form the Worker also
    // accepts, so a second writer's entries are never silently dropped.
    const normalized: GenerationEntry | null = Array.isArray(entry)
      ? typeof entry[0] === "number" && typeof entry[1] === "number"
        ? { gen: entry[0], expires_at: new Date(entry[1] * 1000).toISOString() }
        : null
      : entry && typeof entry.gen === "number" && typeof entry.expires_at === "string"
        ? entry
        : null;
    if (normalized && normalized.gen > 0 && Date.parse(normalized.expires_at) > now.getTime()) {
      generations[entryKey] = normalized;
    }
  }
  const existing = generations[key];
  generations[key] = {
    gen: (existing?.gen ?? 0) + 1,
    expires_at: new Date(now.getTime() + EXPIRY_DAYS * 24 * 60 * 60 * 1000).toISOString(),
  };
  return { schema: 1, v: doc.v + 1, generations };
}

function wranglerKv(args: string[]): string {
  const wrangler = join(import.meta.dir, "..", "packages", "unpkg-www", "node_modules", ".bin", "wrangler");
  return execFileSync(wrangler, ["kv", "key", ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

async function namespaceIdFor(envName: "staging" | "production"): Promise<string> {
  const configPath = join(import.meta.dir, "..", "packages", "unpkg-www", "wrangler.json");
  const config = JSON.parse(await Bun.file(configPath).text()) as {
    kv_namespaces?: { binding: string; id: string }[];
    env?: Record<string, { kv_namespaces?: { binding: string; id: string }[] }>;
  };
  const bindings = envName === "production" ? config.kv_namespaces : config.env?.["staging"]?.kv_namespaces;
  const found = bindings?.find((binding) => binding.binding === "CACHE_GENERATIONS");
  if (!found) throw new Error(`CACHE_GENERATIONS binding not found in wrangler.json for ${envName}`);
  return found.id;
}

export function parseArgs(args: string[]): { target: string; envName: "staging" | "production"; dryRun: boolean } {
  let target: string | undefined;
  let envName: "staging" | "production" = "staging";
  let dryRun = false;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--dry-run") {
      dryRun = true;
    } else if (arg === "--env") {
      const value = args[++i];
      if (value !== "staging" && value !== "production") {
        throw new Error(`--env must be staging or production, got: ${value}`);
      }
      envName = value;
    } else if (arg.startsWith("--env=")) {
      const value = arg.slice("--env=".length);
      if (value !== "staging" && value !== "production") {
        throw new Error(`--env must be staging or production, got: ${value}`);
      }
      envName = value;
    } else if (arg.startsWith("--")) {
      throw new Error(`Unknown flag: ${arg}`);
    } else if (target == null) {
      target = arg;
    } else {
      throw new Error(`Unexpected extra argument: ${arg}`);
    }
  }
  if (!target) {
    throw new Error("Usage: bun scripts/cache-evict.ts <package@version> [--env staging|production] [--dry-run]");
  }
  return { target, envName, dryRun };
}

async function main(): Promise<void> {
  const { target, envName, dryRun } = parseArgs(process.argv.slice(2));

  const { packageName, version } = parsePackageVersionArg(target);
  const key = `${packageName}@${version}`;
  const namespaceId = await namespaceIdFor(envName);

  // Read-modify-write with verification and bounded retries: KV has no
  // CAS, so a concurrent eviction can overwrite ours (or be overwritten
  // by ours). Any non-missing-key read failure aborts BEFORE a put, so a
  // transient CLI/auth failure can never wipe other live evictions.
  for (let attempt = 1; attempt <= 3; attempt++) {
    let currentText: string | null = null;
    try {
      currentText = wranglerKv(["get", GENERATIONS_KV_KEY, "--namespace-id", namespaceId, "--remote"]);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      if (!/not found|no key named|key not found|does not exist/i.test(detail)) {
        throw new Error(`Failed to read ${GENERATIONS_KV_KEY} from KV; aborting without writing. ${detail}`);
      }
      // Key does not exist yet: start from an empty document.
      currentText = null;
    }

    const current = parseDocument(currentText);
    const next = bumpDocument(current, key, new Date());
    const serialized = JSON.stringify(next);
    const bytes = new TextEncoder().encode(serialized).length;
    if (bytes > MAX_BYTES) {
      throw new Error(`Generations document would exceed ${MAX_BYTES} bytes (${bytes}); investigate before evicting`);
    }
    if (bytes > WARN_BYTES) {
      console.warn(`Warning: generations document is ${bytes} bytes; review purge volume`);
    }

    console.log(
      `${dryRun ? "[dry-run] " : ""}${envName}: ${key} generation ${current.generations[key]?.gen ?? 0} -> ` +
        `${next.generations[key].gen} (expires ${next.generations[key].expires_at}, ` +
        `${Object.keys(next.generations).length} live entries, doc v${current.v} -> v${next.v})`
    );
    if (dryRun) return;

    const dir = mkdtempSync(join(tmpdir(), "cache-evict-"));
    try {
      const file = join(dir, "generations.json");
      writeFileSync(file, serialized);
      wranglerKv(["put", GENERATIONS_KV_KEY, "--path", file, "--namespace-id", namespaceId, "--remote"]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }

    const readBack = parseDocument(
      wranglerKv(["get", GENERATIONS_KV_KEY, "--namespace-id", namespaceId, "--remote"])
    );
    const verified = readBack.generations[key];
    const allPreserved = Object.entries(next.generations).every(
      ([entryKey, entry]) => (readBack.generations[entryKey]?.gen ?? 0) >= entry.gen
    );
    if (verified && verified.gen >= next.generations[key].gen && allPreserved) {
      console.log(`Verified in KV: ${key} gen=${verified.gen} (document v${readBack.v})`);
      console.log("Workers pick this up on their next cache-generations refresh (~60s).");
      return;
    }
    console.warn(`Attempt ${attempt}: read-back did not contain the expected document; retrying`);
  }
  throw new Error(`Could not verify the eviction for ${key} after 3 attempts; check the KV document manually`);
}

if (import.meta.main) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
