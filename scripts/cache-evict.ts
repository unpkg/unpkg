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
 *
 * Origin fan-out (production only, default on): edge eviction alone
 * is not a purge — the Fly origin holds its own tarball/file-tier
 * copies of the version and would re-serve it on refetch. After the
 * KV bump verifies, this script also POSTs /_purge to every serving
 * Fly machine (via `fly ssh console`) and requires a 200 eviction
 * report from each. Needs `fly` on PATH, Fly auth, and
 * UNPKG_PURGE_TOKEN set to the same value as the origin's Fly
 * secret; without the token the origin leg is skipped with a loud
 * warning. --no-origin opts out explicitly.
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

export interface FlyMachine {
  id: string;
  region?: string;
  state?: string;
  cordoned?: boolean;
}

/** Serving (non-cordoned, started) machine ids from `fly machine list --json`. */
export function parseServingMachines(jsonText: string): { id: string; region: string }[] {
  let parsed = JSON.parse(jsonText) as FlyMachine[];
  if (!Array.isArray(parsed)) throw new Error("Unexpected fly machine list output; refusing to fan out");
  return parsed
    .filter((m) => m && typeof m.id === "string" && !m.cordoned && m.state === "started")
    .map((m) => ({ id: m.id, region: m.region ?? "?" }));
}

const SAFE_TOKEN = /^[A-Za-z0-9._\-+]+$/;

/**
 * The in-machine purge command, run via `fly ssh console -C`. The
 * origin has no curl; bun's fetch is the HTTP client. Inputs are
 * charset-validated because they are interpolated into a shell
 * single-quoted string.
 */
export function buildOriginPurgeCommand(packageName: string, version: string, token: string): string {
  if (!SAFE_TOKEN.test(token)) throw new Error("UNPKG_PURGE_TOKEN contains characters unsafe for shell interpolation");
  if (!SAFE_TOKEN.test(version) || !/^((?:@[^/@]+\/)?[^/@]+)$/.test(packageName) || /['"\\]/.test(packageName)) {
    throw new Error(`Unsafe purge target: ${packageName}@${version}`);
  }
  let body = JSON.stringify({ packageName, version });
  return `bun -e 'const r=await fetch("http://localhost:3000/_purge",{method:"POST",headers:{authorization:"Bearer ${token}","content-type":"application/json"},body:${JSON.stringify(body)}});console.log("PURGE_RESULT "+r.status+" "+(await r.text()))'`;
}

/** Parse the marker line from an in-machine purge run. Throws unless HTTP 200 with an evicted report. */
export function parseOriginPurgeOutput(stdout: string): { tarball: boolean; file: boolean; extracted: boolean } {
  let line = stdout.split("\n").find((l) => l.includes("PURGE_RESULT "));
  if (!line) throw new Error(`No purge result in machine output: ${stdout.slice(0, 200)}`);
  let match = /PURGE_RESULT (\d{3}) (\{.*\})/.exec(line);
  if (!match || match[1] !== "200") throw new Error(`Origin purge failed: ${line.slice(0, 200)}`);
  let payload = JSON.parse(match[2]) as { evicted?: { tarball: boolean; file: boolean; extracted: boolean } };
  if (!payload.evicted) throw new Error(`Origin purge returned no eviction report: ${line.slice(0, 200)}`);
  return payload.evicted;
}

function fly(args: string[]): string {
  return execFileSync(process.env.FLYCTL ?? "fly", args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 120_000,
  });
}

async function purgeOrigin(
  packageName: string,
  version: string,
  envName: "staging" | "production",
  dryRun: boolean,
  enabled: boolean
): Promise<void> {
  if (envName !== "production") {
    console.log("Origin purge: skipped (staging has no Fly fleet leg in this script).");
    return;
  }
  if (!enabled) {
    console.log("Origin purge: skipped (--no-origin). WARNING: origin caches still hold this version.");
    return;
  }
  let token = process.env.UNPKG_PURGE_TOKEN;
  if (!token) {
    console.warn(
      "Origin purge: SKIPPED — UNPKG_PURGE_TOKEN is not set. The edge generation was bumped, but origin " +
        "machines still hold this version and will re-serve it on refetch. Set UNPKG_PURGE_TOKEN (same value " +
        "as the Fly secret) and rerun to complete a true purge."
    );
    return;
  }
  let machines = parseServingMachines(fly(["machine", "list", "-a", "unpkg", "--json"]));
  if (dryRun) {
    console.log(`[dry-run] Origin purge: would purge ${packageName}@${version} on ${machines.length} machines.`);
    return;
  }
  console.log(`Origin purge: purging ${packageName}@${version} on ${machines.length} serving machines...`);
  let command = buildOriginPurgeCommand(packageName, version, token);
  let failures: string[] = [];
  for (let machine of machines) {
    let lastError: unknown;
    let done = false;
    for (let attempt = 1; attempt <= 2 && !done; attempt++) {
      try {
        let out = fly(["ssh", "console", "-a", "unpkg", "--machine", machine.id, "-C", command]);
        let evicted = parseOriginPurgeOutput(out);
        console.log(
          `  ${machine.region} ${machine.id}: tarball=${evicted.tarball} file=${evicted.file} extracted=${evicted.extracted}`
        );
        done = true;
      } catch (error) {
        lastError = error;
      }
    }
    if (!done) {
      failures.push(machine.id);
      console.error(`  ${machine.region} ${machine.id}: FAILED (${lastError instanceof Error ? lastError.message.slice(0, 160) : lastError})`);
    }
  }
  if (failures.length > 0) {
    throw new Error(
      `Origin purge failed on ${failures.length}/${machines.length} machines (${failures.join(", ")}); ` +
        "the edge generation bump succeeded, but those machines still hold the version. Rerun to retry."
    );
  }
  console.log(`Origin purge: verified on all ${machines.length} machines.`);
}

export function parseArgs(args: string[]): {
  target: string;
  envName: "staging" | "production";
  dryRun: boolean;
  origin: boolean;
} {
  let target: string | undefined;
  let envName: "staging" | "production" = "staging";
  let dryRun = false;
  let origin = true;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--no-origin") {
      origin = false;
    } else if (arg === "--dry-run") {
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
    throw new Error(
      "Usage: bun scripts/cache-evict.ts <package@version> [--env staging|production] [--dry-run] [--no-origin]"
    );
  }
  return { target, envName, dryRun, origin };
}

async function main(): Promise<void> {
  const { target, envName, dryRun, origin } = parseArgs(process.argv.slice(2));

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
    if (dryRun) {
      await purgeOrigin(packageName, version, envName, true, origin);
      return;
    }

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
      // Edge eviction alone is not a purge any more: the Fly origin
      // holds its own tarball/file-tier copies (since #522/#523) and
      // would re-serve the version on refetch. Fan out to it too.
      await purgeOrigin(packageName, version, envName, false, origin);
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
