import * as semver from "semver";
import type { PackageFileListing } from "unpkg-worker";

import { env } from "./env.ts";
import {
  buildEsmModule,
  normalizeBuildOptions,
  transformInlineEsmModule,
  UnsupportedDynamicRequireError,
  UnsupportedSourceTypeError,
} from "./esm-build-service.ts";
import { timingSafeEqual } from "node:crypto";

import {
  getFile,
  listFiles,
  OverloadedError,
  PackageNotFoundError,
  purgePackageVersion,
  TarballFetchTimeoutError,
} from "./npm-files.ts";
import { logRequest } from "./request-logging.ts";

const publicNpmRegistry = "https://registry.npmjs.org";

export async function handleRequest(request: Request): Promise<Response> {
  try {
    let start = Date.now();
    let response = await handleRequest_(request);

    if (env.MODE !== "test") {
      logRequest(request, response, Date.now() - start);
    }

    if (request.method === "HEAD") {
      return new Response(null, response);
    }

    return response;
  } catch (error) {
    console.error(error);

    return new Response("Internal Server Error", { status: 500 });
  }
}

async function handleRequest_(request: Request): Promise<Response> {
  let url = new URL(request.url);
  let isInlineTransformRequest = url.pathname === "/transform" && request.method === "POST";

  // Operator cache purge: evict one exact package@version from
  // every origin cache tier on this machine. Token-gated because
  // the origin is public; disabled unless UNPKG_PURGE_TOKEN is
  // set (via Fly secrets, never fly.json). Fan-out across machines
  // is the caller's job (see scripts/cache-evict.ts).
  if (url.pathname === "/_purge") {
    if (request.method !== "POST") {
      return new Response("Invalid request method: purge requires POST", { status: 405 });
    }
    let token = process.env.UNPKG_PURGE_TOKEN;
    if (!token) {
      return new Response("Purge endpoint is not configured", { status: 503 });
    }
    let provided = request.headers.get("authorization") ?? "";
    let expected = `Bearer ${token}`;
    let a = Buffer.from(provided);
    let b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      return new Response("Unauthorized", { status: 401 });
    }
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return new Response("Invalid JSON request body", { status: 400 });
    }
    let { packageName, version } = (body ?? {}) as { packageName?: unknown; version?: unknown };
    if (
      typeof packageName !== "string" ||
      !/^((?:@[^/@]+\/)?[^/@]+)$/.test(packageName) ||
      typeof version !== "string" ||
      semver.clean(version) !== version
    ) {
      return new Response("Invalid purge body: expected {packageName, version} with an exact version", {
        status: 400,
      });
    }
    let evicted = await purgePackageVersion(publicNpmRegistry, packageName, version);
    console.log(
      `[purge] ${packageName}@${version} tarball=${evicted.tarball} file=${evicted.file} extracted=${evicted.extracted}`
    );
    return Response.json({ package: packageName, version, evicted });
  }

  if (request.method === "OPTIONS") {
    return new Response(null, {
      headers: {
        Allow: "GET, HEAD, OPTIONS, POST",
      },
    });
  }
  if (request.method !== "GET" && request.method !== "HEAD" && !isInlineTransformRequest) {
    return new Response(`Invalid request method: ${request.method}`, { status: 405 });
  }

  if (url.pathname === "/_health") {
    return new Response("OK");
  }
  if (url.pathname === "/favicon.ico") {
    return notFound();
  }

  try {
    if (isInlineTransformRequest) {
      let body = await readInlineTransformRequest(request);
      if ("response" in body) {
        return body.response;
      }

      let result = await transformInlineEsmModule(publicNpmRegistry, {
        filename: body.filename,
        source: body.source,
        options: normalizeBuildOptions(url.searchParams),
      });

      return new Response(result.code, {
        headers: result.headers,
      });
    }

    if (url.pathname.startsWith("/build")) {
      let parsed = parsePackagePathname(url.pathname.slice(6));
      if (parsed == null) {
        return notFound(`Invalid build pathname: ${url.pathname}`);
      }

      let { package: packageName, version, filename } = parsed;

      if (version == null) {
        return notFound(`Missing version in pathname: ${url.pathname}`);
      }
      if (semver.clean(version) !== version) {
        return notFound(`Invalid version: ${version}`);
      }

      let result = await buildEsmModule(publicNpmRegistry, {
        packageName,
        version,
        filename,
        options: normalizeBuildOptions(url.searchParams),
      });
      if (result == null) {
        return notFound(`Build input not found: ${url.pathname}`);
      }

      return new Response(result.code, {
        headers: result.headers,
      });
    }

    if (url.pathname.startsWith("/file")) {
      let parsed = parsePackagePathname(url.pathname.slice(5));
      if (parsed == null) {
        return notFound(`Invalid file pathname: ${url.pathname}`);
      }

      let { package: packageName, version, filename } = parsed;

      if (version == null) {
        return notFound(`Missing version in pathname: ${url.pathname}`);
      }
      if (semver.clean(version) !== version) {
        return notFound(`Invalid version: ${version}`);
      }
      if (filename == null || filename === "/") {
        return notFound(`Missing filename in pathname: ${url.pathname}`);
      }

      let file = await getFile(publicNpmRegistry, packageName, version, filename);
      if (file == null) {
        return notFound(`File not found: ${url.pathname}`);
      }

      let [algorithm, hash] = file.integrity.split("-", 2);

      return new Response(file.bodyStream ?? file.body, {
        headers: {
          "Cache-Control": "public, max-age=31536000",
          "Content-Digest": `${algorithm}=:${hash}:`,
          "Content-Length": file.size.toString(),
          "Content-Type": file.type,
        },
      });
    }

    if (url.pathname.startsWith("/list")) {
      let parsed = parsePackagePathname(url.pathname.slice(5));
      if (parsed == null) {
        return notFound(`Invalid list pathname: ${url.pathname}`);
      }

      let { package: packageName, version, filename } = parsed;

      if (version == null) {
        return notFound(`Missing version in pathname: ${url.pathname}`);
      }
      if (semver.clean(version) !== version) {
        return notFound(`Invalid version: ${version}`);
      }

      let prefix = filename ?? "/";

      // List tarball contents
      let files = await listFiles(publicNpmRegistry, packageName, version, prefix);
      let fileListing: PackageFileListing = {
        package: packageName,
        version,
        prefix,
        files,
      };

      return Response.json(fileListing, {
        headers: {
          "Cache-Control": "public, max-age=31536000",
          "Content-Type": "application/json",
        },
      });
    }
  } catch (error) {
    if (error instanceof PackageNotFoundError) {
      return notFound(`Package not found: ${error.packageName}@${error.version}`);
    }
    if (error instanceof OverloadedError) {
      return new Response("Origin busy, retry shortly", {
        status: 429,
        headers: { "Retry-After": "1" },
      });
    }
    if (error instanceof TarballFetchTimeoutError) {
      return new Response(`Timed out fetching package: ${error.packageName}@${error.version}`, {
        status: 504,
      });
    }
    if (error instanceof UnsupportedSourceTypeError) {
      return new Response(error.message, {
        status: 415,
      });
    }
    if (error instanceof UnsupportedDynamicRequireError) {
      return new Response(error.message, {
        status: 422,
      });
    }

    throw error;
  }

  return notFound(`Not found: ${url.pathname}${url.search}`);
}

async function readInlineTransformRequest(request: Request): Promise<
  | {
      filename: string;
      source: string;
    }
  | { response: Response }
> {
  let value: unknown;
  try {
    value = await request.json();
  } catch {
    return { response: new Response("Invalid JSON request body", { status: 400 }) };
  }

  if (typeof value !== "object" || value == null) {
    return { response: new Response("Invalid transform request body", { status: 400 }) };
  }

  let body = value as Record<string, unknown>;
  if (typeof body.source !== "string") {
    return { response: new Response("Missing source in transform request body", { status: 400 }) };
  }
  if (body.filename != null && typeof body.filename !== "string") {
    return { response: new Response("Invalid filename in transform request body", { status: 400 }) };
  }

  return {
    filename: body.filename ?? "/inline.tsx",
    source: body.source,
  };
}

function notFound(message?: string, init?: ResponseInit): Response {
  return new Response(message ?? "Not Found", { status: 404, ...init });
}

function parsePackagePathname(pathname: string): {
  package: string;
  scope?: string;
  version?: string;
  filename?: string;
} | null {
  try {
    pathname = decodeURIComponent(pathname);
  } catch (e) {
    console.error(`Failed to decode pathname: ${pathname}`);
  }

  let match = /^\/((?:(@[^/@]+)\/)?[^/@]+)(?:@([^/]+))?(\/.*)?$/.exec(pathname);

  if (match == null) return null;

  return {
    package: match[1],
    scope: match[2],
    version: match[3],
    filename: match[4],
  };
}
