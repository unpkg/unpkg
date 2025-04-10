import type { VNode } from "preact";
import { render } from "preact-render-to-string";
import {
  fetchFile,
  getPackageInfo,
  listFiles,
  parsePackagePathname,
  resolvePackageExport,
  resolvePackageVersion,
  rewriteImports,
} from "unpkg-worker";

import { AssetsContext } from "./assets-context.ts";
import { loadAssetsManifest } from "./assets-manifest.ts";
import type { Env } from "./env.ts";
import { Document } from "./components/document.tsx";
import { Home } from "./components/home.tsx";

const publicNpmRegistry = "https://registry.npmjs.org";

export async function handleRequest(request: Request, env: Env, context: ExecutionContext): Promise<Response> {
  if (request.method === "OPTIONS") {
    return new Response(null, {
      headers: {
        Allow: "GET, HEAD, OPTIONS",
        "Access-Control-Allow-Headers": "*",
        "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
        "Access-Control-Allow-Origin": "*",
      },
    });
  }
  if (request.method !== "GET" && request.method !== "HEAD") {
    return new Response(`Invalid request method: ${request.method}`, {
      status: 405,
    });
  }

  let url = new URL(request.url);

  if (url.pathname === "/_health") {
    return new Response("OK");
  }
  if (url.pathname === "/favicon.ico") {
    return notFound();
  }
  if (url.pathname === "/index.html") {
    return redirect("/", 301);
  }
  if (url.pathname === "/") {
    return renderPage(env, <Home />, {
      headers: {
        "Cache-Control": env.DEV ? "no-store" : "public, max-age=60, s-maxage=300",
      },
    });
  }

  // Redirect legacy /browse/* URLs to the app's /files view
  if (url.pathname.startsWith("/browse/")) {
    let parsed = parsePackagePathname(url.pathname.slice(7));
    if (parsed) {
      return redirect(new URL(filesPathname(parsed.package, parsed.version, parsed.filename), env.APP_ORIGIN), 301);
    }
  }

  // Parse and validate the package path
  let parsed = parsePackagePathname(url.pathname);
  if (parsed == null) {
    return notFound(`Invalid URL pathname: ${url.pathname}`);
  }

  let packageName = parsed.package.toLowerCase();
  let packageInfo = await getPackageInfo(context, publicNpmRegistry, packageName);
  if (packageInfo == null) {
    return notFound(`Package not found: ${parsed.package}`);
  }

  let version = resolvePackageVersion(packageInfo, parsed.version ?? "latest");
  if (version == null || packageInfo.versions == null || packageInfo.versions[version] == null) {
    return notFound(`Package version not found: ${packageName}@${parsed.version}`);
  }

  let packageJson = packageInfo.versions[version];
  let filename = parsed.filename;

  // Handle ?meta requests
  if (url.searchParams.has("meta")) {
    let prefix = filename == null ? "/" : filename.replace(/\/*$/, "/");

    // If the version number is not already resolved, redirect to a permanent URL
    if (version !== parsed.version) {
      return redirect(`/${packageName}@${version}${prefix}${url.search}`, {
        headers: {
          "Cache-Control": "public, max-age=60, s-maxage=300",
        },
      });
    }

    let files = await listFiles(context, env.FILES_ORIGIN, packageName, version, prefix);
    let fileListing = {
      package: packageName,
      version,
      prefix,
      files,
    };

    return Response.json(fileListing, {
      headers: {
        "Cache-Control": "public, max-age=31536000",
        "Cache-Tag": "meta", // This allows us to purge the cache if ?meta behavior ever changes
        "Content-Type": "application/json",
        "Access-Control-Allow-Headers": "*",
        "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
        "Access-Control-Allow-Origin": "*",
        "Cross-Origin-Resource-Policy": "cross-origin",
      },
    });
  }

  // Support "append a /" behavior for viewing file listings in the app
  if (filename != null && filename.endsWith("/")) {
    // If the version number is already resolved, we can issue a permanent redirect (301)
    if (version === parsed.version) {
      return redirect(new URL(filesPathname(packageName, version, filename), env.APP_ORIGIN), 301);
    }

    // Otherwise it should be temporary (302)
    return redirect(new URL(filesPathname(packageName, version, filename), env.APP_ORIGIN), {
      headers: {
        "Cache-Control": "public, max-age=60, s-maxage=300",
      },
    });
  }

  // Try to resolve the filename using package.json exports, main, etc.
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

  // If the resolved filename is different from the original filename, redirect to the new URL
  if (resolvedFilename != null && resolvedFilename !== filename) {
    let location = `/${packageName}@${version}${resolvedFilename}${url.search}`;

    // If the version number is already resolved, we can issue a permanent redirect (301)
    if (version === parsed.version) {
      return redirect(location, {
        status: 301,
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Cross-Origin-Resource-Policy": "cross-origin",
        },
      });
    }

    // Otherwise it should be temporary (302)
    return redirect(location, {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Cache-Control": "public, max-age=60, s-maxage=300",
        "Cross-Origin-Resource-Policy": "cross-origin",
      },
    });
  }

  // Maximize cache hits by redirecting to the permanent URL if the version
  // number is different from the one that was used in the request
  if (version !== parsed.version) {
    return redirect(`/${packageName}@${version}${filename ?? ""}${url.search}`, {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Cache-Control": "public, max-age=60, s-maxage=300",
        "Cross-Origin-Resource-Policy": "cross-origin",
      },
    });
  }

  let files = await listFiles(context, env.FILES_ORIGIN, packageName, version);

  if (filename != null && files.some((file) => file.path.toLowerCase() === filename.toLowerCase())) {
    let response = await fetchFile(context, env.FILES_ORIGIN, packageName, version, filename);

    if (response != null) {
      // In ?module requests, rewrite imports to unpkg.com/* URLs in JavaScript modules
      if (
        response.headers.has("Content-Type") &&
        response.headers.get("Content-Type")!.startsWith("text/javascript") &&
        url.searchParams.has("module")
      ) {
        let code = new TextDecoder().decode(await response.arrayBuffer());
        let deps = Object.assign({}, packageJson.peerDependencies, packageJson.dependencies);
        let newCode = rewriteImports(code, url.origin, deps);

        return new Response(newCode, {
          headers: {
            "Cache-Control": "public, max-age=31536000",
            "Cache-Tag": "js-module", // This allows us to purge the cache if ?module behavior ever changes
            "Content-Type": "text/javascript; charset=utf-8",
            "Access-Control-Allow-Headers": "*",
            "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Expose-Headers": "*",
            "Cross-Origin-Resource-Policy": "cross-origin",
          },
        });
      }

      // In all other requests adjust some headers and pass the response straight through
      let headers = new Headers(response.headers);

      // Cache the response for 1 year if it isn't already set
      if (!headers.has("Cache-Control")) {
        headers.set("Cache-Control", "public, max-age=31536000");
      }

      // Serve JavaScript files with charset="utf-8"
      if (headers.get("Content-Type") === "text/javascript") {
        headers.set("Content-Type", "text/javascript; charset=utf-8");
      }

      // Add CORS headers
      headers.set("Access-Control-Allow-Headers", "*");
      headers.set("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS");
      headers.set("Access-Control-Allow-Origin", "*");
      headers.set("Access-Control-Expose-Headers", "*");
      headers.set("Cross-Origin-Resource-Policy", "cross-origin");

      let body = await response.arrayBuffer();

      return new Response(body, {
        status: response.status,
        statusText: response.statusText,
        headers,
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
  let basename = filename == null || filename === "/" ? "" : filename.replace(/\/+$/, "");
  let match =
    files.find((file) => file.path === `${basename}.js`) || files.find((file) => file.path === `${basename}/index.js`);
  if (match != null) {
    return redirect(`/${packageName}@${version}${match.path}${url.search}`, {
      status: 301, // Version number in the URL is already resolved, so this is a permanent redirect
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Cross-Origin-Resource-Policy": "cross-origin",
      },
    });
  }

  return notFound(`Not found: ${url.pathname}${url.search}`);
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

async function renderPage(env: Env, node: VNode, init?: ResponseInit): Promise<Response> {
  let assetsManifest = await loadAssetsManifest(env);

  let html = render(
    <AssetsContext.Provider value={assetsManifest}>
      <Document origin={env.ORIGIN}>{node}</Document>
    </AssetsContext.Provider>
  );

  return new Response("<!DOCTYPE html>" + html, {
    ...init,
    headers: {
      "Content-Type": "text/html",
      ...init?.headers,
    },
  });
}

function filesPathname(packageName: string, version?: string, filename?: string): string {
  // The /files prefix is not needed for the root of the file browser.
  let path = filename == null || filename === "/" ? "" : `/files${filename.replace(/\/+$/, "")}`;
  return `/${packageName}${version ? `@${version}` : ""}${path}`;
}
