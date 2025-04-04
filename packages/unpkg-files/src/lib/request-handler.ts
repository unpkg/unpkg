import * as semver from "semver";
import type { PackageFileListing } from "unpkg-worker";

import { env } from "./env.ts";
import { getFile, listFiles } from "./npm-files.ts";
import { logRequest } from "./request-logging.ts";

const publicNpmRegistry = "https://registry.npmjs.org";

export async function handleRequest(request: Request): Promise<Response> {
  try {
    let response: Response;
    if (env.DEBUG) {
      let start = Date.now();
      response = await handleRequest_(request);
      logRequest(request, response, Date.now() - start);
    } else {
      response = await handleRequest_(request);
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
  if (request.method === "OPTIONS") {
    return new Response(null, {
      headers: {
        Allow: "GET, HEAD, OPTIONS",
      },
    });
  }
  if (request.method !== "GET" && request.method !== "HEAD") {
    return new Response(`Invalid request method: ${request.method}`, { status: 405 });
  }

  let url = new URL(request.url);

  if (url.pathname === "/_health") {
    return new Response("OK");
  }
  if (url.pathname === "/favicon.ico") {
    return notFound();
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

    return new Response(file.body, {
      headers: {
        "Cache-Control": "public, max-age=31536000",
        "Content-Digest": `${algorithm}=:${hash}:`,
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

  return notFound(`Not found: ${url.pathname}${url.search}`);
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
