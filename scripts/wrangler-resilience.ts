#!/usr/bin/env bun

// Wrangler (workerd) resilience scenarios for the verified origin fetch.
//
// These run the real unpkg-www worker under `wrangler dev` against a fake
// files origin that can be switched between healthy, truncated, dying,
// 502-only, not-found, and content-changing behaviours. They exist because
// the Workers runtime differs from Bun in ways unit tests cannot observe
// (fetch `this` binding, crypto.DigestStream shape, Cache API behaviour
// when a stored body stream errors).
//
// Usage:
//   bun scripts/wrangler-resilience.ts           chaos scenarios (fake origin)
//   bun scripts/wrangler-resilience.ts --real    also real-origin smoke tests
//
// Both modes need network access to registry.npmjs.org (package metadata
// is resolved from the real registry even when files come from the fake
// origin). Nothing here deploys or writes outside temp directories.

import { spawn, type ChildProcess } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const repoRoot = path.resolve(import.meta.dir, "..");
const wwwDir = path.join(repoRoot, "packages/unpkg-www");
const esmDir = path.join(repoRoot, "packages/unpkg-esm");
const filesDir = path.join(repoRoot, "packages/unpkg-files");

let failures = 0;

function check(name: string, condition: boolean, detail = ""): void {
  console.log(`${condition ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  if (!condition) failures += 1;
}

function start(command: string, args: string[], options: { cwd?: string; env?: Record<string, string> } = {}): ChildProcess {
  let child = spawn(command, args, {
    cwd: options.cwd,
    env: { ...process.env, ...options.env },
    stdio: ["ignore", "ignore", "ignore"],
  });
  return child;
}

async function stop(child: ChildProcess | undefined): Promise<void> {
  if (child == null || child.exitCode !== null) return;
  child.kill("SIGTERM");
  await Promise.race([
    new Promise((resolve) => child.once("exit", resolve)),
    new Promise((resolve) => setTimeout(resolve, 5000)),
  ]);
  if (child.exitCode === null) child.kill("SIGKILL");
}

async function waitFor(url: string, timeoutMs = 120000): Promise<void> {
  let started = Date.now();
  for (;;) {
    try {
      let response = await fetch(url);
      if (response.ok) return;
    } catch {}
    if (Date.now() - started > timeoutMs) throw new Error(`Timed out waiting for ${url}`);
    await Bun.sleep(500);
  }
}

async function hashBody(response: Response): Promise<{ total: number; sha256: string }> {
  let hash = createHash("sha256");
  let total = 0;
  if (response.body == null) {
    return { total: 0, sha256: hash.digest("hex") };
  }
  let reader = response.body.getReader();
  for (;;) {
    let { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    hash.update(value);
  }
  return { total, sha256: hash.digest("hex") };
}

function sha256Hex(body: Uint8Array): string {
  return createHash("sha256").update(body).digest("hex");
}

// The fake origin is spawned under Node (for exact control over socket
// teardown mid-body). It serves fabricated bodies for real package names
// (the workers resolve package metadata from the real registry), with
// self-consistent Content-Length / Content-Digest headers.
const FAKE_ORIGIN_SOURCE = `
import { createHash } from "node:crypto";
import http from "node:http";

const small = new TextEncoder().encode('export const small = "' + "x".repeat(5000) + '";\\n');
const large = new Uint8Array(5 * 1024 * 1024);
for (let i = 0; i < large.length; i++) large[i] = (i * 31 + 7) % 251;
const largeB = new Uint8Array(5 * 1024 * 1024);
for (let i = 0; i < largeB.length; i++) largeB[i] = (i * 17 + 3) % 239;
const huge = new Uint8Array(50 * 1024 * 1024);
for (let i = 0; i < huge.length; i++) huge[i] = (i * 13 + 11) % 241;

const digest = (body) => createHash("sha256").update(body).digest("base64");
let mode = "healthy";
let counts = { smallFile: 0, largeFile: 0, hugeFile: 0, list: 0 };

function bodyFor(pathname) {
  if (pathname.includes("is-even")) return { body: large, alt: largeB, kind: "largeFile" };
  if (pathname.includes("is-number")) return { body: huge, alt: huge, kind: "hugeFile" };
  return { body: small, alt: small, kind: "smallFile" };
}

const server = http.createServer((req, res) => {
  let url = new URL(req.url, "http://localhost");
  if (url.pathname === "/__mode") {
    mode = url.searchParams.get("m") || "healthy";
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ mode }));
    return;
  }
  if (url.pathname === "/__counts") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ mode, counts }));
    return;
  }

  let { body, alt, kind } = bodyFor(url.pathname);

  if (url.pathname.startsWith("/list/")) {
    counts.list++;
    let payload = JSON.stringify({
      package: "fake", version: "1.0.0", prefix: "/",
      files: [{ path: "/index.js", size: body.length, type: "text/javascript", integrity: "sha256-" + digest(body) }],
    });
    res.writeHead(200, {
      "Cache-Control": "public, max-age=31536000",
      "Content-Type": "application/json",
      "Content-Length": Buffer.byteLength(payload),
    });
    res.end(payload);
    return;
  }

  if (url.pathname.startsWith("/file/")) {
    counts[kind]++;
    let attempt = counts[kind];
    let headers = (b) => ({
      "Cache-Control": "public, max-age=31536000",
      "Content-Length": b.length,
      "Content-Digest": "sha256=:" + digest(b) + ":",
      "Content-Type": "text/javascript",
    });

    if (mode === "notfound") {
      res.writeHead(404, { "Content-Type": "text/plain" });
      res.end("Not Found");
      return;
    }
    if (mode === "badgateway") {
      res.writeHead(502, { "Content-Type": "text/plain" });
      res.end("Bad Gateway");
      return;
    }
    if (mode === "die") {
      res.writeHead(200, headers(body));
      res.write(body.subarray(0, Math.floor(body.length * 0.4)), () => res.socket.destroy());
      return;
    }
    if (mode === "change" && attempt === 1) {
      res.writeHead(200, headers(body));
      res.write(body.subarray(0, Math.floor(body.length * 0.4)), () => res.socket.destroy());
      return;
    }
    if (mode === "change") {
      res.writeHead(200, headers(alt));
      res.end(alt);
      return;
    }
    res.writeHead(200, headers(body));
    res.end(body);
    return;
  }

  res.writeHead(404);
  res.end("not found");
});

server.listen(Number(process.env.FAKE_PORT || 4680), "127.0.0.1");
`;

// Fabricated bodies, regenerated identically to the fake origin's so the
// runner can assert byte-exactness by hash.
function fabricatedBodies(): { small: Uint8Array; large: Uint8Array; huge: Uint8Array } {
  let small = new TextEncoder().encode(`export const small = "${"x".repeat(5000)}";\n`);
  let large = new Uint8Array(5 * 1024 * 1024);
  for (let i = 0; i < large.length; i++) large[i] = (i * 31 + 7) % 251;
  let huge = new Uint8Array(50 * 1024 * 1024);
  for (let i = 0; i < huge.length; i++) huge[i] = (i * 13 + 11) % 241;
  return { small, large, huge };
}

async function runChaos(): Promise<void> {
  console.log("== wrangler chaos scenarios (fake origin) ==\n");

  let bodies = fabricatedBodies();
  let stateDir = await mkdtemp(path.join(tmpdir(), "unpkg-resilience-"));
  let fakePath = path.join(stateDir, "fake-origin.mjs");
  await writeFile(fakePath, FAKE_ORIGIN_SOURCE);

  let fakePort = 4680;
  let wwwPort = 3110;
  let fakeBase = `http://127.0.0.1:${fakePort}`;
  let base = `http://127.0.0.1:${wwwPort}`;

  let counts = async () => (await (await fetch(`${fakeBase}/__counts`)).json()).counts;
  let setMode = async (mode: string) => {
    await fetch(`${fakeBase}/__mode?m=${mode}`);
  };

  let fake = start("node", [fakePath], { env: { FAKE_PORT: String(fakePort) } });
  let www: ChildProcess | undefined;
  try {
    await waitFor(`${fakeBase}/__counts`, 15000);
    www = start(
      "./node_modules/.bin/wrangler",
      ["dev", "--env", "dev", "--port", String(wwwPort), "--persist-to", stateDir, "--var", `FILES_ORIGIN:${fakeBase}`],
      { cwd: wwwDir, env: { CI: "true", WRANGLER_SEND_METRICS: "false" } }
    );
    await waitFor(`${base}/_health`);
    console.log("worker ready\n");

    // 4xx: exactly one origin fetch, no retry amplification.
    await setMode("notfound");
    let before = await counts();
    let notFound = await fetch(`${base}/is-odd@3.0.1/index.js`);
    await notFound.arrayBuffer();
    let after = await counts();
    check("404 from origin is not retried", after.smallFile - before.smallFile === 1, `origin file fetches=${after.smallFile - before.smallFile}`);
    check("404 surfaces as 404 to client", notFound.status === 404, `status=${notFound.status}`);

    // Origin dies mid-body on every attempt: 500, 3 attempts, nothing cached.
    await setMode("die");
    before = await counts();
    let died = await fetch(`${base}/is-odd@3.0.1/index.js`);
    await died.arrayBuffer();
    after = await counts();
    check("always-dying origin yields 500, not a truncated 200", died.status === 500, `status=${died.status}`);
    check("always-dying origin is attempted 3 times", after.smallFile - before.smallFile === 3, `attempts=${after.smallFile - before.smallFile}`);
    let diedAgain = await fetch(`${base}/is-odd@3.0.1/index.js`);
    await diedAgain.arrayBuffer();
    let afterAgain = await counts();
    check("failure is not cached (second request retries origin)", afterAgain.smallFile - after.smallFile === 3, `attempts=${afterAgain.smallFile - after.smallFile}`);

    // Origin always 502: same bounded behaviour on a fresh package.
    await setMode("badgateway");
    before = await counts();
    let badGateway = await fetch(`${base}/is-string@1.0.0/index.js`);
    await badGateway.arrayBuffer();
    after = await counts();
    check("always-502 origin yields 500", badGateway.status === 500, `status=${badGateway.status}`);
    check("always-502 origin is attempted 3 times", after.smallFile - before.smallFile === 3, `attempts=${after.smallFile - before.smallFile}`);

    // Content changes between attempts: never splice two different bodies.
    await setMode("change");
    let changeInvalid = false;
    try {
      let changeResponse = await fetch(`${base}/is-even@1.0.0/index.js`);
      let changeResult = await hashBody(changeResponse);
      changeInvalid = changeResult.total !== bodies.large.byteLength;
    } catch {
      changeInvalid = true;
    }
    check("content change between attempts never yields a complete file", changeInvalid);

    // The same URL succeeds byte-exactly once the origin recovers.
    await setMode("healthy");
    let healed = await fetch(`${base}/is-even@1.0.0/index.js`);
    let healedHash = await hashBody(healed);
    check(
      "same URL succeeds after origin recovers",
      healed.status === 200 && healedHash.sha256 === sha256Hex(bodies.large),
      `status=${healed.status} bytes=${healedHash.total}`
    );

    // Concurrency: parallel cold requests for a 50 MiB file all succeed.
    let parallel = await Promise.all(
      Array.from({ length: 6 }, async () => {
        let response = await fetch(`${base}/is-number@7.0.0/index.js`);
        let result = await hashBody(response);
        return response.status === 200 && result.sha256 === sha256Hex(bodies.huge);
      })
    );
    check("6 parallel 50 MiB cold requests all byte-exact", parallel.every(Boolean));

    // HEAD on a warm file: 200 and no body.
    let head = await fetch(`${base}/is-even@1.0.0/index.js`, { method: "HEAD" });
    let headBody = await hashBody(head);
    check("HEAD returns 200 with no body", head.status === 200 && headBody.total === 0, `status=${head.status}`);

    // The internal verification marker never reaches clients.
    let markerCheck = await fetch(`${base}/is-odd@3.0.1/index.js`);
    await markerCheck.arrayBuffer();
    check("internal verification marker never leaks to clients", markerCheck.headers.get("X-Unpkg-Body-Verification") === null);
  } finally {
    await stop(www);
    await stop(fake);
    await rm(stateDir, { recursive: true, force: true });
  }
}

async function runRealSmoke(): Promise<void> {
  console.log("\n== real-origin smoke (unpkg-files + www + esm workers) ==\n");

  let filesPort = 4100;
  let wwwPort = 3111;
  let esmPort = 3112;
  let origin = `http://127.0.0.1:${filesPort}`;
  let base = `http://127.0.0.1:${wwwPort}`;
  let esmBase = `http://127.0.0.1:${esmPort}`;

  let files = start("bun", ["--port", String(filesPort), "./src/server.ts"], {
    cwd: filesDir,
    env: { MODE: "test" },
  });
  let www: ChildProcess | undefined;
  let esm: ChildProcess | undefined;
  try {
    await waitFor(`${origin}/_health`, 60000);
    www = start(
      "./node_modules/.bin/wrangler",
      ["dev", "--env", "dev", "--port", String(wwwPort), "--var", `FILES_ORIGIN:${origin}`],
      { cwd: wwwDir, env: { CI: "true", WRANGLER_SEND_METRICS: "false" } }
    );
    await waitFor(`${base}/_health`);
    esm = start(
      "./node_modules/.bin/wrangler",
      ["dev", "--env", "dev", "--port", String(esmPort), "--var", `FILES_ORIGIN:${origin}`],
      { cwd: esmDir, env: { CI: "true", WRANGLER_SEND_METRICS: "false" } }
    );
    await waitFor(`${esmBase}/_health`).catch(() => {});
    console.log("servers ready\n");

    let viaWorker = Buffer.from(await (await fetch(`${base}/is-odd@3.0.1/index.js`)).arrayBuffer());
    let direct = Buffer.from(await (await fetch(`${origin}/file/is-odd@3.0.1/index.js`)).arrayBuffer());
    check("real small file via worker identical to origin", viaWorker.equals(direct), `${viaWorker.length} bytes`);

    let lodashWorker = Buffer.from(await (await fetch(`${base}/lodash@4.17.21/lodash.js`)).arrayBuffer());
    let lodashDirect = Buffer.from(await (await fetch(`${origin}/file/lodash@4.17.21/lodash.js`)).arrayBuffer());
    check("real lodash via worker identical to origin", lodashWorker.equals(lodashDirect), `${lodashWorker.length} bytes`);

    let moduleResponse = await fetch(`${base}/preact@10.19.3/dist/preact.module.js?module`);
    let moduleBody = await moduleResponse.text();
    check("?module transform still works", moduleResponse.status === 200 && moduleBody.length > 5000, `status=${moduleResponse.status}`);

    let metaResponse = await fetch(`${base}/lodash@4.17.21/?meta`);
    let meta = (await metaResponse.json()) as { files?: unknown[] };
    check("?meta listing still works", metaResponse.status === 200 && Array.isArray(meta.files) && meta.files.length > 10);

    let redirect = await fetch(`${base}/lodash`, { redirect: "manual" });
    check(
      "mutable version still redirects to pinned",
      redirect.status === 302 && /lodash@4\.\d+\.\d+\//.test(redirect.headers.get("Location") ?? "")
    );

    let missing = await fetch(`${base}/lodash@4.17.21/does-not-exist.js`);
    await missing.arrayBuffer();
    check("missing file still 404", missing.status === 404, `status=${missing.status}`);

    let esmResponse = await fetch(`${esmBase}/preact@10.19.3`);
    let esmBody = await esmResponse.text();
    check(
      "esm worker serves a built module",
      esmResponse.status === 200 && esmBody.length > 1000,
      `status=${esmResponse.status} bytes=${esmBody.length}`
    );
    check("esm responses do not leak the verification marker", esmResponse.headers.get("X-Unpkg-Body-Verification") === null);
  } finally {
    await stop(esm);
    await stop(www);
    await stop(files);
  }
}

let includeReal = process.argv.includes("--real");

try {
  await runChaos();
  if (includeReal) {
    await runRealSmoke();
  }
} catch (error) {
  console.error("HARNESS ERROR:", error);
  failures += 1;
}

console.log(failures === 0 ? "\nALL RESILIENCE CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
