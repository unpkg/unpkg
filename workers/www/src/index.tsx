import { type VNode } from "preact";
import { render } from "preact-render-to-string";

import { AssetsContext, loadAssetsManifest } from "./assets.ts";
import { Document } from "./components/document.tsx";
import { Home } from "./components/home.tsx";
import { getContentType } from "./content-type.ts";
import { ContextProvider } from "./context.ts";
import { type Env } from "./env.ts";
import { HttpError } from "./http-error.ts";
import { resolvePackageExport } from "./pkg-exports.ts";
import { fetchPackageInfo } from "./pkg-info.ts";
import { fetchPackageTarball } from "./pkg-tarball.ts";
import { resolvePackageVersion } from "./pkg-version.ts";
import { rewriteImports } from "./rewrite-imports.ts";

export default {
  async fetch(request, env, ctx) {
    if (request.method !== "GET" && request.method !== "HEAD") {
      return new Response(`Invalid request method: ${request.method}`, {
        status: 405,
      });
    }

    // This worker caches its own successful responses so it can avoid parsing the
    // same package tarball again and again
    // @ts-ignore - Looks like @cloudflare/workers-types is missing this?
    let cache = caches.default as Cache;
    let response = await cache.match(request);

    if (response == null) {
      try {
        response = await handleRequest(request, env, ctx);

        if (request.method === "GET" && (response.ok || response.headers.has("Cache-Control"))) {
          ctx.waitUntil(cache.put(request, response.clone()));
        }
      } catch (error) {
        if (error instanceof HttpError) {
          return new Response(error.message, { status: error.status });
        }

        console.error(error);

        return new Response("Internal Server Error", { status: 500 });
      }
    }

    if (request.method === "HEAD") {
      return new Response(null, response);
    }

    return response;
  },
} satisfies ExportedHandler<Env>;

async function handleRequest(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  let url = new URL(request.url);

  if (url.pathname === "/favicon.ico") {
    return notFound();
  }
  if (url.pathname === "/index.html") {
    return redirect("/", 301);
  }
  if (url.pathname === "/") {
    return renderPage(<Home />, env, {
      headers: {
        "Cache-Control": "no-store",
      },
    });
  }

  // Redirect legacy /browse/* URLs to the app worker's /files view
  if (url.pathname.startsWith("/browse/")) {
    let parsed = parsePackagePathname(url.pathname.slice(7));
    if (parsed) {
      url.host = env.APP_HOST;
      url.pathname = createFilesPathname(parsed.package, parsed.version, parsed.filename);
      return redirect(url /*, 301*/);
    }
  }

  let parsed = parsePackagePathname(url.pathname);
  if (parsed == null) {
    return notFound(`Invalid URL pathname: ${url.pathname}`);
  }

  let packageInfo = await fetchPackageInfo(parsed, env, ctx);
  if (packageInfo == null) {
    return notFound(`Package not found: ${parsed.package}`);
  }

  let packageName = parsed.package;
  let version = resolvePackageVersion(packageInfo, parsed.version ?? "latest");
  if (version == null || packageInfo.versions == null || packageInfo.versions[version] == null) {
    return notFound(`Package version not found: ${packageName}@${parsed.version}`);
  }

  let packageJson = packageInfo.versions[version];
  let filename = parsed.filename;

  // Handle ?meta requests
  if (url.searchParams.has("meta")) {
    let prefix = filename == null ? "/" : filename.replace(/\/*$/, "/");

    if (version !== parsed.version || prefix !== parsed.filename) {
      return redirect(`${url.origin}/${packageName}@${version}${prefix}${url.search}`);
    }

    let files = await listFiles({ ...parsed, version, prefix }, env, ctx);
    let fileListing: PackageFileListing = {
      package: packageName,
      version,
      prefix,
      files,
    };

    return new Response(JSON.stringify(fileListing), {
      headers: {
        "Cache-Control": "public, max-age=31536000",
        "Content-Type": "application/json",
      },
    });
  }

  // Support "append a /" behavior for viewing file listings that are handled the app worker
  if (filename != null && filename.endsWith("/")) {
    url.host = env.APP_HOST;
    url.pathname = createFilesPathname(packageName, version, filename);
    return redirect(url);
  }

  let conditions = url.searchParams.has("conditions")
    ? url.searchParams.getAll("conditions").flatMap((condition) => condition.split(","))
    : undefined;
  let wantsBrowser = url.searchParams.has("browser");
  let wantsModule = url.searchParams.has("module");

  let resolvedFilename = resolvePackageExport(packageJson, filename ?? "/", {
    useBrowserField: wantsBrowser,
    useModuleField: wantsModule,
    conditions,
  });

  if (resolvedFilename != null && resolvedFilename !== filename) {
    return redirect(`${url.origin}/${packageName}@${version}${resolvedFilename}${url.search}`, {
      headers: {
        "Access-Control-Allow-Origin": "*",
      },
    });
  }

  // Maximize cache hits by redirecting to the correct version if the resolved version
  // is different from the one that was requested in the URL
  if (version !== parsed.version) {
    return redirect(`${url.origin}/${packageName}@${version}${filename ?? ""}${url.search}`, {
      headers: {
        "Access-Control-Allow-Origin": "*",
      },
    });
  }

  if (filename != null) {
    let file = await getFile({ ...parsed, version, filename }, env, ctx);

    if (file != null) {
      let [algorithm, hash] = file.integrity.split("-", 2);

      // Rewrite imports for JavaScript modules when ?module is used
      if (file.type === "text/javascript" && url.searchParams.has("module")) {
        let code = new TextDecoder().decode(file.body);
        let deps = Object.assign({}, packageJson.peerDependencies, packageJson.dependencies);
        let newCode = rewriteImports(code, url.origin, deps);
        file.body = new TextEncoder().encode(newCode);
      }

      return new Response(file.body, {
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Expose-Headers": "*",
          "Cache-Control": "public, max-age=31536000",
          "Content-Digest": `${algorithm}=:${hash}:`,
          "Content-Type": file.type,
        },
      });
    }
  }

  // We were unable to find a file based on either the original filename in the URL,
  // or the resolved filename from package.json (exports, main, etc.). Try to find a
  // matching file based on some legacy Node.js heuristics.
  // Redirect
  // - /path/to/file => /path/to/file.js
  // - /path/to/file => /path/to/file/index.js
  // if either of those files exist. This is to support legacy Node.js behavior where a
  // request for files without an extension will resolve to a .js file or a directory with
  // an index.js file.
  // See https://nodejs.org/api/modules.html#file-modules and
  // https://nodejs.org/api/modules.html#folders-as-modules
  let files = await listFiles({ ...parsed, version, prefix: "/" }, env, ctx);
  let basename = filename == null || filename === "/" ? "" : filename.replace(/\/+$/, "");
  let matchingFile =
    files.find((file) => file.path === `${basename}.js`) || files.find((file) => file.path === `${basename}/index.js`);
  if (matchingFile != null) {
    return redirect(`${url.origin}/${packageName}@${version}${matchingFile.path}${url.search}`, {
      headers: {
        "Access-Control-Allow-Origin": "*",
      },
    });
  }

  return notFound(`Not found: ${url.pathname}${url.search}`);
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

function notFound(message?: string, init?: ResponseInit): Response {
  return new Response(message ?? "Not Found", { status: 404, ...init });
}

function redirect(location: string | URL, init?: ResponseInit | number): Response {
  if (typeof init === "number") {
    return new Response(`Redirecting to ${location}`, {
      status: init,
      headers: {
        Location: location.toString(),
      },
    });
  }

  return new Response(`Redirecting to ${location}`, {
    status: 302,
    ...init,
    headers: {
      Location: location.toString(),
      ...init?.headers,
    },
  });
}

async function renderPage(node: VNode, env: Env, init?: ResponseInit): Promise<Response> {
  let context = new ContextProvider([
    [
      AssetsContext,
      await loadAssetsManifest({
        origin: env.ASSETS_ORIGIN,
        dev: env.MODE === "development",
      }),
    ],
  ]);

  let html = render(<Document context={context}>{node}</Document>);

  return new Response("<!DOCTYPE html>" + html, {
    ...init,
    headers: {
      "Content-Type": "text/html",
      ...init?.headers,
    },
  });
}

function createFilesPathname(packageName: string, version?: string, filename?: string): string {
  // The /files prefix is not needed for the root of the file browser.
  let path = filename == null || filename === "/" ? "" : `/files${filename.replace(/\/+$/, "")}`;
  return `/${packageName}${version ? `@${version}` : ""}${path}`;
}

export interface PackageFile {
  path: string;
  body: Uint8Array;
  size: number;
  type: string;
  integrity: string;
}

export type PackageFileMetadata = Omit<PackageFile, "body">;

export interface PackageFileListing {
  package: string;
  version: string;
  prefix: string;
  files: PackageFileMetadata[];
}

async function getFile(
  req: { package: string; version: string; filename: string },
  env: Env,
  ctx: ExecutionContext,
): Promise<PackageFile | null> {
  let file: PackageFile | null = null;

  await fetchPackageTarball(req, env, ctx, async (entry, path) => {
    if (path.toLowerCase() !== req.filename.toLowerCase()) {
      return;
    }

    file = {
      path,
      body: entry.content,
      size: entry.size,
      type: getContentType(path),
      integrity: await getSubresourceIngtegrity(entry.content),
    };
  });

  return file;
}

async function listFiles(
  req: { package: string; version: string; prefix: string },
  env: Env,
  ctx: ExecutionContext,
): Promise<PackageFileMetadata[]> {
  let files: PackageFileMetadata[] = [];

  await fetchPackageTarball(req, env, ctx, async (entry, path) => {
    if (path.endsWith("/") || !path.startsWith(req.prefix)) {
      return;
    }

    files.push({
      path,
      size: entry.size,
      type: getContentType(path),
      integrity: await getSubresourceIngtegrity(entry.content),
    });
  });

  return files;
}

async function getSubresourceIngtegrity(buffer: Uint8Array): Promise<string> {
  // Use SHA-256 so we can reuse the same hash for the Content-Digest header
  let digest = await crypto.subtle.digest("SHA-256", buffer);
  let base64 = btoa(String.fromCharCode.apply(null, new Uint8Array(digest) as any));
  return `sha256-${base64}`;
}
